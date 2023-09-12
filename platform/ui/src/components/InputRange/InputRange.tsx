import React, { useState, useCallback, useEffect } from 'react';
import classNames from 'classnames';
import { InputNumber } from '../../components';
import './InputRange.css';
import getMaxDigits from '../../utils/getMaxDigits';

/**
 * React Range Input component
 * it has two props, value and onChange
 * value is a number value
 * onChange is a function that will be called when the range input is changed
 *
 *
 */
type InputRangeProps = {
  value: number;
  onChange: (value: number) => void;
  minValue: number;
  maxValue: number;
  step: number;
  unit?: string;
  containerClassName?: string;
  inputClassName?: string;
  labelClassName?: string;
  labelVariant?: string;
  showLabel?: boolean;
  labelPosition?: string;
  trackColor?: string;
  allowNumberEdit?: boolean;
  showAdjustmentArrows?: boolean;
};

const InputRange: React.FC<InputRangeProps> = ({
  value,
  onChange,
  minValue,
  maxValue,
  step = 1,
  unit = '',
  containerClassName,
  inputClassName,
  labelClassName,
  labelVariant,
  showLabel = true,
  labelPosition = 'right',
  trackColor,
  allowNumberEdit = false,
  showAdjustmentArrows = true,
}) => {
  const [rangeValue, setRangeValue] = useState(value);

  const maxDigits = getMaxDigits(maxValue, step);
  const labelWidth = `${maxDigits * 10}px`;

  useEffect(() => setRangeValue(value), [value]);

  const handleChange = useCallback(
    e => {
      const val = Number(e.target.value);
      setRangeValue(val);
      onChange(val);
    },
    [onChange]
  );

  const rangeValuePercentage = ((rangeValue - minValue) / (maxValue - minValue)) * 100;

  const LabelOrEditableNumber = allowNumberEdit ? (
    <InputNumber
      minValue={minValue}
      maxValue={maxValue}
      value={rangeValue}
      onChange={val => {
        setRangeValue(val);
        onChange(val);
      }}
      step={step}
      showAdjustmentArrows={showAdjustmentArrows}
    />
  ) : (
    <span className={classNames(labelClassName ?? 'text-white')}>
      {value}
      {unit}
    </span>
  );

  return (
    <div
      className={`flex cursor-pointer items-center ${containerClassName ?? ''}`}
      onClick={e => {
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      <div className="relative flex w-full items-center">
        {showLabel && labelPosition === 'left' && LabelOrEditableNumber}
        <div className="range-track"></div>
        <input
          type="range"
          min={minValue}
          max={maxValue}
          value={rangeValue}
          className={`h-[3px] appearance-none rounded-md ${inputClassName ?? ''}`}
          style={{
            background: `linear-gradient(to right, #5acce6 0%, #5acce6 ${rangeValuePercentage}%, #3a3f99 ${rangeValuePercentage}%, #3a3f99 100%)`,
          }}
          onChange={handleChange}
          id="myRange"
          step={step}
        />
        <div style={{ width: labelWidth }}>
          {showLabel && labelPosition === 'right' && LabelOrEditableNumber}
        </div>
      </div>
    </div>
  );
};

export default InputRange;
