# @ohif/extension-rtmedical-theme

RT Medical custom theme and **white-labeling / multi-tenant branding** for OHIF
v3.

Built **extension-first** with zero changes to `@ohif/core`, `@ohif/app` or
`@ohif/ui` (per ADR **RTV-114**). All integration happens through public OHIF
APIs: the `CustomizationService` and the native `whiteLabeling` config hook.

## White-labeling (RTV-156)

Branding is resolved per client/institution and layered in three stages:

1. **Static** — pick the tenant (explicit id → exact hostname → hostname suffix
   → regex → default), inherit visual theme tokens and apply only that tenant's
   identity fields. Synchronous, with no RT identity leaking into partial tenant
   configurations.
2. **Cache** — if branding fetched from the same Connect API endpoint is cached
   in `localStorage` (TTL-bounded), it is layered on immediately for an
   offline-friendly start. Endpoint changes and API removal never reuse stale
   branding from another source.
3. **Network** — fresh branding is fetched from the Connect API, layered on, and
   the local cache is refreshed.

Theme tokens are applied as `--rt-color-*` CSS custom properties; `productName`
and `faviconUrl` are applied to the document `<title>` and favicon.

### Module surface

| Export | Purpose |
| --- | --- |
| `resolveTenant(config, ctx)` | Pure: resolve the active tenant id. |
| `resolveBranding(config, ctx, base?)` | Pure: tenant + static override merged on defaults. |
| `mergeBranding(base, override?)` | Pure deep-merge (immutable). |
| `buildThemeCssVars(theme)` / `applyThemeOverride(theme, el?)` | Theme tokens → CSS vars. |
| `applyDocumentBranding(branding, doc?)` | Page title + favicon. |
| `readBrandingCache` / `writeBrandingCache` / `clearBrandingCache` | `localStorage` cache (TTL, corruption-safe). |
| `fetchBranding({ endpoint, tenantId, fetchImpl?, signal? })` | Connect API fetch; never throws, `null` on failure. |
| `WhiteLabelingProvider` / `useWhiteLabeling()` | React context + hook. |
| `Logo` | Branded logo (image or Carbon-inspired wordmark fallback). |
| `createLogoComponentFn(branding)` | Adapter for OHIF's native `whiteLabeling.createLogoComponentFn`. |

### Configuration (app config)

```js
// platform/app/public/config/*.js
window.config = {
  // ...
  rtmedicalWhiteLabeling: {
    enabled: true,
    apiEndpoint: 'https://connect.rtmedical.ai/api/branding/{tenantId}',
    cacheTtlMs: 86400000, // 24h
    matchers: [
      { tenantId: 'hospital-a', hostnames: ['a.viewer.rtmedical.ai'] },
      { tenantId: 'hospital-b', hostnameSuffixes: ['.b.rtmedical.ai'] },
    ],
    tenants: {
      'hospital-a': {
        productName: 'Hospital A — Imagem',
        logoDarkUrl: '/assets/hospital-a-logo.svg',
        theme: { primary: '#ff6600' },
      },
    },
  },
};
```

### Wiring

1. Register the extension in `platform/app/pluginConfig.json`:

   ```json
   { "packageName": "@ohif/extension-rtmedical-theme", "version": "3.12.5" }
   ```

2. Configure tenants in the app config. The extension registers its root
   provider through OHIF's `ServiceProvidersManager`, so WorkList, auxiliary
   routes and viewer modes all receive the same live branding:

   ```tsx
   window.config = {
     rtmedicalWhiteLabeling: {
       defaultTenant: 'hospital-a',
       tenants: {
         'hospital-a': { productName: 'Hospital A' },
       },
     },
   };
   ```

   An explicitly configured native `whiteLabeling.createLogoComponentFn` is
   preserved. Otherwise, the extension installs a context-backed callback that
   follows cache and Connect API updates.

   Omit `defaultTenant` to use the built-in RT Medical identity. Every non-null
   tenant id, including `defaultTenant`, starts from neutral identity fields and
   must explicitly provide any logo, favicon, support contact or website it uses.
   The registered About modal subscribes to the root provider's live service
   snapshot even though OHIF's modal host sits outside that provider. It does
   not start a second fetch or reapply document effects.

   Default RT logo/favicon assets ship in this extension's `public/assets`
   directory and are copied by the plugin build pipeline.

## CommonHeader (RTV-153)

A mode-shareable application header migrated from connectviewer's `CommonHeader`.
It is **presentational**: branding (logo/product name) comes from the
white-labeling context, while live patient/study/user data and task/menu handlers
are passed as props — bind them to OHIF services at the mode level.

```tsx
import { CommonHeader } from '@ohif/extension-rtmedical-theme/src/components/CommonHeader';

<CommonHeader
  patientName={displaySet?.PatientName}
  studyInfo={`${mrn} • ${studyDescription}`}
  userName={user?.profile?.name}
  onReturn={() => navigate('/')}
  tasks={[
    { id: 'export', label: 'Exportar', onClick: onExport },
    { id: 'keyImages', label: 'Key Images', onClick: onKeyImages },
    { id: 'report', label: 'Laudo', onClick: onReport },
  ]}
  menuItems={[
    { id: 'about', label: 'Sobre', onClick: onAbout },
    { id: 'prefs', label: 'Preferências', onClick: onPreferences },
    { id: 'logout', label: 'Sair', onClick: onLogout },
  ]}
/>;
```

Also exposed via `customizationService.getCustomization('rtmedical.commonHeader')`.
The dropdown (`HeaderDropdown`) is dependency-light (no Radix / `@ohif/ui-next`),
accessible (Escape + outside-click close), and Carbon-inspired via Tailwind only.

## Task actions — `Tarefas` dropdown (RTV-154)

`buildTaskMenuItems` turns the canonical 7-action registry plus runtime context
(user permissions, handlers, confirmation, audit) into the `HeaderMenuItem[]`
that feeds `CommonHeader`'s `tasks` prop. It applies, in order:

1. **Wiring** — only actions with a supplied handler are surfaced.
2. **RBAC** — actions the user may not run are hidden (default) or `disable`d.
   A user is authorized when they hold **all** of an action's
   `requiredPermissions`; the `'*'` permission or the `admin` role grant
   everything.
3. **Confirmation** — destructive (`deleteStudy`) and sensitive
   (`changePatientInfo`) actions are gated behind the injected `confirm`. With
   no `confirm` they **fail safe** (treated as cancelled — nothing destructive
   runs by accident).
4. **Audit** — every attempt is recorded as
   `invoked` → `completed`/`error`, or `cancelled`. The logger forwards to an
   optional sink (e.g. the Connect API); a throwing sink never breaks the action.

```tsx
import {
  buildTaskMenuItems,
  createAuditLogger,
} from '@ohif/extension-rtmedical-theme/src/taskActions';

const audit = createAuditLogger({
  sink: entry => connectApi.postAuditEvent(entry), // optional
});

const tasks = buildTaskMenuItems({
  user: { permissions: user.permissions },        // from OIDC (RTV-155)
  actor: user?.profile?.sub,
  audit,
  unauthorized: 'hide',                            // or 'disable'
  confirm: action =>
    uiModalService.confirm({ title: action.label, destructive: action.destructive }),
  handlers: {
    export: () => commandsManager.runCommand('exportStudy'),
    saveReport: () => commandsManager.runCommand('saveReport'),
    deleteStudy: () => commandsManager.runCommand('deleteStudy'),
    // …only the actions this mode supports
  },
});

<CommonHeader tasks={tasks} /* …patient/study/user props */ />;
```

The module is pure (no `@ohif/*` imports — RTV-114); all side effects are
injected. Also exposed via
`customizationService.getCustomization('rtmedical.taskActions')`
(`{ TASK_ACTIONS, buildTaskMenuItems, canRunAction, createAuditLogger }`).

## Tests

```bash
# from the repo root
yarn jest --selectProjects rtmedical-theme
```

Pure resolvers, cache, fetch, theme/document appliers and the React
provider/hook are covered by unit tests (jest + jsdom + Testing Library).
