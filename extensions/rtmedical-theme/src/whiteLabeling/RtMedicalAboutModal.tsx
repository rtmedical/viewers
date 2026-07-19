import React from 'react';
import { AboutModal } from '@ohif/ui-next';

import { Logo } from './Logo';
import { sanitizeNavigationUrl } from './sanitizeBranding';
import { useWhiteLabeling } from './WhiteLabelingContext';
import { WhiteLabelingService, WhiteLabelingServiceProvider } from './WhiteLabelingRootProvider';

type MenuModalComponent = React.FC & {
  title?: string;
  menuTitle?: string;
  containerClassName?: string;
};

const RtMedicalAboutModal: MenuModalComponent = () => {
  const { branding } = useWhiteLabeling();
  const versionNumber = process.env.VERSION_NUMBER || 'dev';
  const commitHash = process.env.COMMIT_HASH || 'local';
  const [main, beta] = versionNumber.split('-');
  const websiteUrl = sanitizeNavigationUrl(branding.websiteUrl);

  return (
    <AboutModal className="w-[400px]">
      <div className="flex justify-center pt-2">
        <Logo
          className="justify-center"
          imageClassName="!h-16 !max-h-16 !max-w-[220px]"
        />
      </div>

      <AboutModal.ProductName>{branding.productName}</AboutModal.ProductName>
      <AboutModal.ProductVersion>{main}</AboutModal.ProductVersion>
      {beta && <AboutModal.ProductBeta>{beta}</AboutModal.ProductBeta>}

      <AboutModal.Body>
        <AboutModal.DetailItem
          label="Commit"
          value={commitHash}
        />
        {branding.supportEmail && (
          <AboutModal.DetailItem
            label="Suporte"
            value={branding.supportEmail}
          />
        )}
        {websiteUrl && (
          <a
            className="text-primary pt-4 text-base font-medium"
            href={websiteUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {branding.websiteLabel || websiteUrl}
          </a>
        )}
      </AboutModal.Body>
    </AboutModal>
  );
};

function setModalMetadata(Component: MenuModalComponent): MenuModalComponent {
  Component.title = 'About Viewer';
  Component.menuTitle = 'About Viewer';
  Component.containerClassName = 'max-w-md';
  return Component;
}

/**
 * Modals are rendered by ModalProvider above extension root providers. Subscribe
 * to the root provider's service snapshot so the modal cannot race a second
 * resolver or reapply stale document-level branding.
 */
function createRtMedicalAboutModal(service?: WhiteLabelingService): MenuModalComponent {
  const ConfiguredRtMedicalAboutModal: MenuModalComponent = () =>
    service ? (
      <WhiteLabelingServiceProvider service={service}>
        <RtMedicalAboutModal />
      </WhiteLabelingServiceProvider>
    ) : (
      <RtMedicalAboutModal />
    );

  return setModalMetadata(ConfiguredRtMedicalAboutModal);
}

setModalMetadata(RtMedicalAboutModal);

export { createRtMedicalAboutModal, RtMedicalAboutModal };
