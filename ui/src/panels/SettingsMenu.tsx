import { useState } from 'react';
import { WarningLine } from './WarningLine.js';
import { theme } from '../theme.js';
import { FloatingPanel } from '../FloatingPanel.js';
import { SettingsIcon } from '../icons.js';
import { DEFAULT_SETTINGS, SETTING_SPECS, type SettingSpec, type Settings } from '../settings.js';
import type { AgentStatus } from '../electronApi.js';
import { agentConfig } from '../agent/useAgentBridge.js';

/**
 * The Settings card (v2.7, docs/v2.7-settings-cases.md) - the gear at the right
 * end of the top bar, in the same floating card as Help.
 *
 * ⚑ RENDERED FROM `SETTING_SPECS`, so a setting cannot exist without a row here
 * (S1), and every row says what it changes in words rather than leaving it to
 * the label. Each number shows its default beside it, so a changed value is
 * visible as changed without opening anything.
 */

export interface SettingsMenuProps {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  /** The agent server's state, shown under *Let agents use PlotTracer* (M2). */
  agentStatus?: AgentStatus | null;
}

/** Where an agent connects, and what to paste into it (M2) - shown while the
 * switch is on, so turning it on is visibly what made the address exist. */
function AgentConnection({ status }: { status: AgentStatus | null | undefined }) {
  const small = { fontSize: theme.font.size.small, lineHeight: 1.35 } as const;
  if (!status || (!status.listening && !status.error)) {
    return <div data-testid="setting-agents-status" style={{ ...small, color: theme.color.text.legend, marginTop: 4 }}>Starting…</div>;
  }
  if (status.error) {
    return <div style={{ marginTop: 4 }}><WarningLine id="setting-agents-status" text={status.error} /></div>;
  }
  const cfg = agentConfig(status);
  if (!cfg) return null;
  const copy = (text: string) => { void navigator.clipboard?.writeText(text).catch(() => undefined); };
  const code = {
    display: 'block', fontFamily: 'monospace', fontSize: theme.font.size.small, whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-all' as const, background: theme.color.background.panel, border: `1px solid ${theme.color.border.regular}`,
    borderRadius: theme.border.radius.regular, padding: '4px 6px', margin: '2px 0 4px',
  };
  return (
    <div style={{ marginTop: 6 }}>
      <div data-testid="setting-agents-status" style={small}>
        Listening on this computer only, at <span data-testid="setting-agents-address" style={{ fontFamily: 'monospace' }}>{cfg.url}</span>
      </div>
      <div style={{ ...small, marginTop: 4 }}>To connect an agent, give it these MCP settings:</div>
      <code data-testid="setting-agents-config" style={code}>{cfg.json}</code>
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" data-testid="setting-agents-copy-config" onClick={() => copy(cfg.json)}>Copy settings</button>
      </div>
      <div style={{ ...small, color: theme.color.text.legend, marginTop: 4 }}>
        The token in it is the key: only a client holding it can connect, and a web page never can.
      </div>
    </div>
  );
}

const caption = {
  fontSize: theme.font.size.small,
  fontWeight: 600,
  textTransform: 'uppercase' as const,
  letterSpacing: 0.4,
  color: theme.color.text.legend,
  margin: '8px 0 4px',
};

function NumberSetting({ spec, value, onChange }: {
  spec: Extract<SettingSpec, { kind: 'number' }>;
  value: number;
  onChange: (v: number) => void;
}) {
  // The typed text is kept apart from the value, so a half-typed "0." is not
  // thrown away; only a value inside the limits is ever applied.
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(value);
  const n = Number(shown);
  const valid = shown.trim() !== '' && Number.isFinite(n) && n >= spec.min && n <= spec.max && (!spec.integer || Number.isInteger(n));
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <input
        type="number"
        data-testid={`setting-${spec.key}`}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={shown}
        aria-invalid={!valid}
        onChange={(e) => {
          const t = e.target.value;
          setDraft(t);
          const v = Number(t);
          if (t.trim() !== '' && Number.isFinite(v) && v >= spec.min && v <= spec.max && (!spec.integer || Number.isInteger(v))) onChange(v);
        }}
        onBlur={() => setDraft(null)}
        style={{
          width: 70,
          border: `1px solid ${valid ? theme.color.border.regular : theme.color.error}`,
          borderRadius: theme.border.radius.regular,
          padding: '2px 4px',
        }}
      />
      <span style={{ minWidth: 66, fontSize: theme.font.size.small, color: valid ? theme.color.text.legend : theme.color.error }}>
        {valid ? `default ${DEFAULT_SETTINGS[spec.key] as number}` : `${spec.min} to ${spec.max}`}
      </span>
    </span>
  );
}

/** A folder, chosen with the system's own folder picker (M6). */
function FolderSetting({ label, value, testId, onChange }: { label: string; value: string; testId: string; onChange: (v: string) => void }) {
  const choose = window.electronAPI?.chooseFolder;
  return (
    <div>
      <div style={{ fontWeight: 600 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
        <span
          data-testid={testId}
          title={value || undefined}
          style={{
            flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', direction: 'rtl', textAlign: 'left',
            fontSize: theme.font.size.small, color: value ? theme.color.text.primary : theme.color.text.legend,
          }}
        >
          {value || 'None chosen - agents cannot open or save files'}
        </span>
        <button type="button" data-testid={`${testId}-choose`} disabled={!choose} onClick={() => { void choose?.().then((p) => { if (p) onChange(p); }); }}>
          Choose…
        </button>
        {value && (
          <button type="button" data-testid={`${testId}-clear`} onClick={() => onChange('')}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

export function SettingsMenu({ settings, onChange, agentStatus }: SettingsMenuProps) {
  const groups = [...new Set(SETTING_SPECS.map((s) => s.group))];
  const isDefault = SETTING_SPECS.every((s) => settings[s.key] === DEFAULT_SETTINGS[s.key]);
  return (
    <FloatingPanel label="Settings" icon={<SettingsIcon />} hideLabel testId="settings">
      <div style={{ width: 420, color: theme.color.text.primary, fontSize: theme.font.size.regular }}>
        {groups.map((g) => (
          <div key={g}>
            <div style={caption}>{g}</div>
            {SETTING_SPECS.filter((s) => s.group === g && (!s.under || settings[s.under] === true)).map((spec) => (
              <div key={spec.key} data-testid={`setting-row-${spec.key}`} style={{ padding: '4px 0 6px', ...(spec.under ? { marginLeft: 22 } : {}) }}>
                {spec.kind === 'folder' ? (
                  <FolderSetting label={spec.label} value={settings[spec.key] as string} testId={`setting-${spec.key}`} onChange={(v) => onChange({ [spec.key]: v })} />
                ) : spec.kind === 'choice' ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontWeight: 600 }}>{spec.label}</span>
                    <span role="radiogroup" aria-label={spec.label} style={{ display: 'flex', gap: 10 }}>
                      {spec.options.map((o) => (
                        <label key={o.value} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name={`setting-${spec.key}`}
                            data-testid={`setting-${spec.key}-${o.value}`}
                            checked={settings[spec.key] === o.value}
                            onChange={() => onChange({ [spec.key]: o.value })}
                          />
                          {o.label}
                        </label>
                      ))}
                    </span>
                  </div>
                ) : spec.kind === 'boolean' ? (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      data-testid={`setting-${spec.key}`}
                      checked={settings[spec.key] as boolean}
                      onChange={(e) => onChange({ [spec.key]: e.target.checked })}
                    />
                    {spec.label}
                  </label>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontWeight: 600 }}>{spec.label}</span>
                    <NumberSetting
                      spec={spec}
                      value={settings[spec.key] as number}
                      onChange={(v) => onChange({ [spec.key]: v })}
                    />
                  </div>
                )}
                <div style={{ fontSize: theme.font.size.small, color: theme.color.text.secondary, marginTop: 2, lineHeight: 1.35 }}>
                  {spec.explains}
                </div>
                {spec.key === 'agentsEnabled' && settings.agentsEnabled && <AgentConnection status={agentStatus} />}
              </div>
            ))}
          </div>
        ))}
        <div style={{ height: 1, background: theme.color.border.regular, margin: '8px 0' }} />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: theme.font.size.small, color: theme.color.text.legend }}>
            Settings are kept on this computer, never in a project file.
          </span>
          <button
            type="button"
            data-testid="settings-restore-defaults"
            disabled={isDefault}
            title={isDefault ? 'Every setting is at its default' : 'Put every setting back to its default'}
            onClick={() => onChange({ ...DEFAULT_SETTINGS })}
          >
            Restore defaults
          </button>
        </div>
      </div>
    </FloatingPanel>
  );
}
