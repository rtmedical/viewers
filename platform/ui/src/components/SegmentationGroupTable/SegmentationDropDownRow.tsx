import React from 'react';
import { Select, Icon, Dropdown } from '../../components';
import PropTypes from 'prop-types';

function SegmentationDropDownRow({
  segmentations = [],
  activeSegmentation,
  onActiveSegmentationChange,
  disableEditing,
  onToggleSegmentationVisibility,
  onSegmentationEdit,
  onSegmentationDownload,
  storeSegmentation,
  onSegmentationDelete,
  onSegmentationAdd,
}) {
  const handleChange = option => {
    onActiveSegmentationChange(option.value); // Notify the parent
  };

  const selectOptions = segmentations.map(s => ({
    value: s.id,
    label: s.label,
  }));

  if (!activeSegmentation) {
    return null;
  }

  return (
    <div className="group mx-0.5 mt-[8px] flex items-center">
      <div
        onClick={e => {
          e.stopPropagation();
        }}
      >
        <Dropdown
          id="segmentation-dropdown"
          showDropdownIcon={false}
          alignment="left"
          itemsClassName="text-primary-active"
          showBorders={false}
          list={[
            ...(!disableEditing
              ? [
                  {
                    title: 'Add New Segmentation',
                    onClick: () => {
                      onSegmentationAdd();
                    },
                  },
                ]
              : []),
            ...(!disableEditing
              ? [
                  {
                    title: 'Rename',
                    onClick: () => {
                      onSegmentationEdit(activeSegmentation.id);
                    },
                  },
                ]
              : []),
            {
              title: 'Delete',
              onClick: () => {
                onSegmentationDelete(activeSegmentation.id);
              },
            },
            ...(!disableEditing
              ? [
                  {
                    title: 'Export DICOM SEG',
                    onClick: () => {
                      storeSegmentation(activeSegmentation.id);
                    },
                  },
                  {
                    title: 'Download',
                    onClick: () => {
                      onSegmentationDownload(activeSegmentation.id);
                    },
                  },
                ]
              : []),
          ]}
        >
          {/* <Icon
            name="icon-more-menu"
            className="w-[20px] h-[20px] grid place-items-center hover:bg-secondary-dark cursor-pointer text-primary-active rounded-[4px] "
          ></Icon> */}
          <div className="hover:bg-secondary-dark mx-1 grid h-[28px] w-[28px]  cursor-pointer place-items-center rounded-[4px]">
            <Icon name="icon-more-menu"></Icon>
          </div>
        </Dropdown>
      </div>
      {selectOptions?.length && (
        <Select
          id="segmentation-select"
          isClearable={false}
          onChange={handleChange}
          components={{
            DropdownIndicator: () => (
              <Icon
                name={'chevron-down-new'}
                className="mr-2"
              />
            ),
          }}
          isSearchable={false}
          options={selectOptions}
          value={selectOptions?.find(o => o.value === activeSegmentation.id)}
          className="text-aqua-pale h-[26px] w-1/2 text-[13px]"
        />
      )}
      <div className="flex items-center">
        <div
          className="hover:bg-secondary-dark ml-3 mr-1 grid h-[28px]  w-[28px] cursor-pointer place-items-center rounded-[4px]"
          onClick={() => onToggleSegmentationVisibility(activeSegmentation.id)}
        >
          {activeSegmentation.isVisible ? (
            <Icon name="row-show-all" />
          ) : (
            <Icon name="row-hide-all" />
          )}
        </div>
      </div>
    </div>
  );
}

SegmentationDropDownRow.propTypes = {
  segmentations: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
    })
  ).isRequired,
  onActiveSegmentationChange: PropTypes.func.isRequired,
};

export default SegmentationDropDownRow;
