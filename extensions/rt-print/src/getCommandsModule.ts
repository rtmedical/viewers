/**
 * Commands for the RT Print panel (RTV-140). Framework-free (no `@ohif/core`).
 */
import { computePrintLayout, PrintLayoutConfig, PrintLayout } from './printLayout';

export function getCommandsModule() {
  const actions = {
    /** Compute the print layout geometry for a config (pure passthrough). */
    computeRtPrintLayout: ({ config }: { config?: PrintLayoutConfig } = {}): PrintLayout =>
      computePrintLayout(config ?? {}),

    /** Trigger the browser print dialog (Save as PDF for PDF export). */
    rtPrint: (): boolean => {
      if (typeof window !== 'undefined' && typeof window.print === 'function') {
        window.print();
        return true;
      }
      return false;
    },
  };

  const definitions = {
    computeRtPrintLayout: { commandFn: actions.computeRtPrintLayout },
    rtPrint: { commandFn: actions.rtPrint },
  };

  return { actions, definitions, defaultContext: 'DEFAULT' };
}

export default getCommandsModule;
