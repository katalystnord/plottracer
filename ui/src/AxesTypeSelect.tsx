import type { SelectChangeEvent } from '@mui/material';
import { FormControl, Select, MenuItem } from '@mui/material';
import styled from '@emotion/styled';
import { theme } from './theme.js';

/**
 * The axes-type dropdown (checkpoint 35, see CLAUDE.md and
 * project_mui_adoption_flagged.md's memory note) -- the second real
 * `@mui/material` component usage, confirmed against Ketcher's own real
 * pattern before writing this: `FormControl` + `Select` + `MenuItem`,
 * found in both `ketcher-macromolecules/src/components/shared/dropDown/
 * dropDown.tsx` (a reusable, fully `styled()`-wrapped version) and
 * `.../modal/Settings/SettingsField.tsx`'s `'select'` case (a simpler,
 * one-off version using MUI's `sx` prop directly). This component follows
 * the simpler shape -- a single, non-reused dropdown, like
 * `SettingsField.tsx`'s -- but styled via `styled()` reading `theme.ts`
 * rather than `sx` with inline hex literals, matching this codebase's own
 * established token-based convention (`IconButton.tsx`/`ZoomControls.tsx`)
 * rather than copying `SettingsField.tsx`'s own inline-hex inconsistency.
 *
 * No custom `renderValue` (unlike `dropDown.tsx`'s own version, which
 * needs one to wrap the label in a `<span>`) -- MUI's `Select` already
 * displays the selected `MenuItem`'s own children by default, and each
 * option's `label` text is all that's needed here.
 */
export interface AxesTypeOption {
  id: string;
  label: string;
}

export interface AxesTypeSelectProps {
  options: readonly AxesTypeOption[];
  value: string;
  onChange: (id: string) => void;
}

const StyledFormControl = styled(FormControl)({
  minWidth: 160,
});

const StyledSelect = styled(Select)({
  height: 32,
  fontSize: theme.font.size.regular,
  fontFamily: theme.font.family,
  color: theme.color.text.primary,
  background: theme.color.background.primary,

  '& .MuiSelect-select': {
    padding: '6px 32px 6px 10px',
  },
  '& .MuiOutlinedInput-notchedOutline': {
    border: `1px solid ${theme.color.border.regular}`,
  },
  '&:hover .MuiOutlinedInput-notchedOutline': {
    borderColor: theme.color.primary.main,
  },
  '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
    borderColor: theme.color.primary.main,
  },
});

export function AxesTypeSelect({ options, value, onChange }: AxesTypeSelectProps) {
  return (
    <StyledFormControl size="small">
      <StyledSelect
        data-testid="axes-type-select"
        value={value}
        onChange={(e: SelectChangeEvent<unknown>) => onChange(e.target.value as string)}
      >
        {options.map((opt) => (
          <MenuItem key={opt.id} value={opt.id} data-testid={`axes-option-${opt.id}`}>
            {opt.label}
          </MenuItem>
        ))}
      </StyledSelect>
    </StyledFormControl>
  );
}
