/**
 * Error-bars fold-out card (checkpoint 79) -- mirrors the Measure (ckpt 52) and
 * Image Edit (ckpt 62) cards' dynamics exactly: a rail icon toggles it, it folds
 * out docked beside the rail, press-again-to-close.
 *
 * **A rail tool, not a graph type, and that is the whole point**
 * (docs/error-bars-design.md). The graph-type dropdown entry it replaces
 * (`ERROR_BAR_AXES_CONFIG`, checkpoint 70's interim restore) forced the choice
 * *before you started*: trace an XY curve, then want error, and you started
 * over. A rail tool inverts it -- trace the curve, press 6, add error to what is
 * already there. That is what makes "error is a property of a series, not a kind
 * of chart" true in the interface rather than only in the model. A plot with no
 * error bars sees one extra icon and nothing else.
 *
 * **The card asks for exactly two things, because the record holds exactly two
 * things**: which series the error belongs to, and what to call it. There is no
 * error *type* (sd/sem/ci95) and no symmetric/asymmetric mode, because both are
 * interpretation and this is recording (David, 2026-07-17: *"We do not even need
 * to know what type of error it represents. All we need is a unique name... If we
 * will do interpretation, that is the next secondary step."*). The name is where
 * the caption's meaning lands, and the user writes it.
 */
import { useState } from 'react';
import styled from '@emotion/styled';
import { theme, glassSurface } from './theme.js';
import { ChevronDownIcon } from './icons.js';

const Card = styled('div')({
  width: 214,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '6px 8px 8px',
  borderRadius: 8,
  // Never overrun a short viewport -- scroll inside instead of spilling off the
  // bottom (v1.1 fast-follow). The card's own box-shadow is unaffected.
  maxHeight: 'calc(100vh - 16px)',
  overflowY: 'auto',
  // Frosted glass: floats over the immutable figure (see glassSurface).
  ...glassSurface,
  border: `1px solid ${theme.color.border.regular}`,
  boxShadow: '0 2px 6px rgba(103, 104, 132, 0.2)',
  pointerEvents: 'auto',
  fontFamily: theme.font.family,
  color: theme.color.text.primary,
});

const HeaderRow = styled('div')({ display: 'flex', alignItems: 'center', gap: 6 });

const FoldButton = styled('button')({
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  display: 'flex',
  color: theme.color.icon.active,
  padding: 2,
});

const Field = styled('label')({
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  fontSize: theme.font.size.small,
  color: theme.color.text.legend,
});

const Input = styled('input')({
  height: 26,
  padding: '0 6px',
  fontSize: theme.font.size.small,
  fontFamily: theme.font.family,
  borderRadius: theme.border.radius.regular,
  border: `1px solid ${theme.color.border.regular}`,
  background: theme.color.background.primary,
  color: theme.color.text.primary,
  ':focus': { outline: 'none', borderColor: theme.color.primary.main },
});

const Select = styled('select')({
  height: 26,
  fontSize: theme.font.size.small,
  fontFamily: theme.font.family,
  borderRadius: theme.border.radius.regular,
  border: `1px solid ${theme.color.border.regular}`,
  background: theme.color.background.primary,
  color: theme.color.text.primary,
});

const Hint = styled('div')({
  fontSize: theme.font.size.small,
  color: theme.color.text.legend,
  lineHeight: 1.35,
});

const Notice = styled('div')({
  fontSize: theme.font.size.small,
  color: theme.color.error,
  lineHeight: 1.3,
});

const Divider = styled('div')({ height: 1, background: theme.color.border.regular, margin: '2px 0' });

const ListHeader = styled('div')({
  fontSize: theme.font.size.small,
  color: theme.color.text.legend,
  fontWeight: 600,
});

const Row = styled('div')({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: theme.font.size.small,
  color: theme.color.text.primary,
});

const Swatch = styled('span')<{ color: string }>(({ color }) => ({
  width: 9,
  height: 9,
  borderRadius: 2,
  background: color,
  flex: '0 0 auto',
}));

/** One error series already related to something, for the card's own list. */
export interface ErrorSeriesRow {
  index: number;
  name: string;
  color: string;
  role: string;
  of: string;
  pointCount: number;
}

/**
 * The error kinds a caption usually names, OFFERED as a datalist.
 *
 * ⚑ Not a picker, and not a default. The card asks for a NAME because the kind
 * is not in the geometry - it is printed in the caption, and only the user can
 * read it. Listing the common words makes transcription quicker; preselecting
 * one would make a reading up, which is the thing `engine/errorRelation.ts`
 * refused an `errorKind` field over.
 */
const ERROR_KIND_SUGGESTIONS = ['SD', 'SEM', '95% CI', 'range', 'IQR'] as const;

export interface ErrorBarsCardProps {
  /** Every series that can be a target (i.e. all of them). */
  targets: { index: number; name: string }[];
  targetIndex: number;
  onTargetChange: (index: number) => void;
  baseName: string;
  onBaseNameChange: (name: string) => void;
  /** Error series that exist already - the visible proof a relation was stored. */
  existing: ErrorSeriesRow[];
  onSelectSeries?: (index: number) => void;
  /** Refusal from the last gesture, shown until the next one. */
  notice?: string | null;
  /** False before calibration: a cap's position has no value to report yet, the
   * same precondition Place Point has. Stated rather than left invisible. */
  calibrated: boolean;
  /** False when the target series has no points to hang error off. */
  targetHasPoints: boolean;
}

export function ErrorBarsCard({
  targets,
  targetIndex,
  onTargetChange,
  baseName,
  onBaseNameChange,
  existing,
  onSelectSeries,
  notice = null,
  calibrated,
  targetHasPoints,
}: ErrorBarsCardProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <Card data-testid="error-bars-card">
      <HeaderRow>
        <FoldButton type="button" onClick={() => setExpanded((v) => !v)} title={expanded ? 'Fold' : 'Unfold'}>
          <span
            style={{
              display: 'inline-block',
              transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
              transition: 'transform 0.15s',
            }}
          >
            <ChevronDownIcon />
          </span>
        </FoldButton>
        <strong style={{ fontSize: theme.font.size.regular }}>Error bars</strong>
      </HeaderRow>

      {expanded && (
        <>
          <Field>
            Error for
            <Select
              data-testid="error-target-select"
              value={targetIndex}
              onChange={(e) => onTargetChange(Number(e.target.value))}
            >
              {targets.map((t) => (
                <option key={t.index} value={t.index} data-testid={`error-target-option-${t.index}`}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field>
            Name
            <Input
              data-testid="error-base-name"
              value={baseName}
              // ⚑ No default value and no default in the placeholder either: a
              // placeholder reading "SD" is still us naming the reading, and it
              // is the string the user will accept by doing nothing. The prompt
              // asks for the caption's own word instead.
              placeholder="from the caption…"
              list="error-kind-suggestions"
              onChange={(e) => onBaseNameChange(e.target.value)}
            />
            {/* ⚑⚑ OFFERED, NEVER PRESELECTED. A datalist shows the vocabulary
                without choosing from it -- David's rule that *"anything we
                present to the user should be out of convenience, not
                absolutes"*. Offering the words helps TRANSCRIPTION; putting one
                in the box INVENTS a reading. Free text stays allowed, because
                the caption is the authority and it says whatever it says. */}
            <datalist id="error-kind-suggestions">
              {ERROR_KIND_SUGGESTIONS.map((kind) => (
                <option key={kind} value={kind} />
              ))}
            </datalist>
          </Field>
          {/* The name is the only meaning we record, so say what it becomes --
              otherwise "SD upper" appearing in the columns is a surprise.
              ⚑ And with no name it ASKS, rather than promising an outcome that
              cannot happen: the model refuses the drag until the field is
              filled, while this line used to describe the SD columns it would
              supposedly write. The card described an outcome the model had
              already ruled out. */}
          <Hint data-testid="error-name-hint">
            {baseName.trim() ? (
              <>
                Records into <strong>{baseName.trim()} upper</strong> and{' '}
                <strong>{baseName.trim()} lower</strong>.
              </>
            ) : (
              <>Name the error as the figure&rsquo;s caption does - its columns take that name.</>
            )}
          </Hint>

          <Divider />

          {/* Every precondition is stated on screen rather than being an
              invisible one -- CLAUDE.md's keystone rule. */}
          {!calibrated ? (
            <Hint data-testid="error-bars-hint">Calibrate the chart first.</Hint>
          ) : !targetHasPoints ? (
            <Hint data-testid="error-bars-hint">
              Place at least one point on <strong>{targets.find((t) => t.index === targetIndex)?.name}</strong> first -
              an error bar hangs off a data point.
            </Hint>
          ) : (
            <Hint data-testid="error-bars-hint">
              {/* ⚑ The third sentence used to read "pick its series under
                  Recorded below, then drag the cap" - a precondition that no
                  longer exists. A cap lives on its datum's own record now (B4),
                  so it belongs to the series you are already working on and is
                  draggable where it stands. That instruction described the
                  hidden mode David could not have discovered; it would now
                  describe one that is not there at all. */}
              Drag from a data point out to its error cap. A cap is placed on each side - the lower one mirrored as a
              starting position. Drag either cap to where the figure draws it.
            </Hint>
          )}

          {notice && <Notice data-testid="error-bars-notice">{notice}</Notice>}

          {existing.length > 0 && (
            <>
              <Divider />
              <ListHeader>Recorded</ListHeader>
              {existing.map((s) => (
                <Row key={s.index} data-testid={`error-series-row-${s.index}`}>
                  <Swatch color={s.color} />
                  <button
                    type="button"
                    onClick={() => onSelectSeries?.(s.index)}
                    title="Select this series to drag its caps"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      font: 'inherit',
                      color: 'inherit',
                      textAlign: 'left',
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {s.name}
                  </button>
                  <span style={{ color: theme.color.text.legend, fontVariantNumeric: 'tabular-nums' }}>
                    {s.pointCount}
                  </span>
                </Row>
              ))}
            </>
          )}
        </>
      )}
    </Card>
  );
}
