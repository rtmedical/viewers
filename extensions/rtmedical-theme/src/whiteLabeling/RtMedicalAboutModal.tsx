import React from 'react';
import { AboutModal } from '@ohif/ui-next';

type MenuModalComponent = React.FC & {
  title?: string;
  menuTitle?: string;
  containerClassName?: string;
};

const RtMedicalAboutModal: MenuModalComponent = () => {
  const versionNumber = process.env.VERSION_NUMBER || 'dev';
  const commitHash = process.env.COMMIT_HASH || 'local';
  const [main, beta] = versionNumber.split('-');

  return (
    <AboutModal className="w-[400px]">
      <div className="flex justify-center pt-2">
        <span className="inline-flex items-center gap-2 text-white">
          <span className="flex h-9 w-9 items-center justify-center border border-[#4589ff] bg-[#0f62fe] text-base font-bold leading-none text-white">
            RT
          </span>
          <span className="text-2xl font-semibold tracking-normal">RT Medical</span>
        </span>
      </div>

      <AboutModal.ProductName>RT Medical Viewer</AboutModal.ProductName>
      <AboutModal.ProductVersion>{main}</AboutModal.ProductVersion>
      {beta && <AboutModal.ProductBeta>{beta}</AboutModal.ProductBeta>}

      <AboutModal.Body>
        <AboutModal.DetailItem
          label="Commit"
          value={commitHash}
        />
        <AboutModal.DetailItem
          label="Suporte"
          value="suporte@rtmedical.com.br"
        />
        <a
          className="text-primary pt-4 text-base font-medium"
          href="https://rtmedical.com.br"
          target="_blank"
          rel="noopener noreferrer"
        >
          rtmedical.com.br
        </a>
      </AboutModal.Body>
    </AboutModal>
  );
};

RtMedicalAboutModal.title = 'About RT Medical Viewer';
RtMedicalAboutModal.menuTitle = 'About RT Medical Viewer';
RtMedicalAboutModal.containerClassName = 'max-w-md';

export { RtMedicalAboutModal };
