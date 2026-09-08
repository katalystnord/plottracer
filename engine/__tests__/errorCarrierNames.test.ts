/**
 * ⚑⚑ EVERY END THAT CAN CARRY ERROR IS NAMED ON SCREEN.
 *
 * A span's second end is otherwise a HIDDEN CAPABILITY: nothing would say you
 * may drag from the low end as well as the high one, and the keystone test is
 * that someone seeing the card for the first time can only use what he sees.
 * The card names both ends rather than leaving him to guess the gesture repeats.
 *
 * ⚠️ AND THE CARD USED TO ASSEMBLE THE LIST ITSELF, from `errorValueSlots.length`
 * on one side and `intervalSlots` on the other. Those are two declarations that
 * must agree, with nothing making them: a type declaring two carriers and no
 * `intervalSlots` yielded an EMPTY list, and an empty list renders as no hint at
 * all. It fails OPEN, and what it fails open on is the sentence that stops the
 * capability being hidden.
 *
 * ⚑ So the rule is checked across the whole REGISTRY, not on the one type that
 * has it today: any type declaring more than one carrier must name them all.
 */
import { describe, expect, it } from 'vitest';
import { CalibrationSession, type CalibratedAxes } from '../calibrationSession.js';
import { ALL_AXES_TYPE_CONFIGS } from '../axesTypeConfigs.js';

describe('the ends that can carry error are named', () => {
  it('every type declaring more than one carrier names one end per carrier', () => {
    for (const config of ALL_AXES_TYPE_CONFIGS) {
      const carriers = config.errorValueSlots ?? [0];
      const s = new CalibrationSession<CalibratedAxes>(config as never);
      const names = s.getErrorCarrierNames();
      if (carriers.length < 2) {
        expect(names, `${config.id} has one carrier and needs no names`).toEqual([]);
        continue;
      }
      expect(names.length, `${config.id} declares ${carriers.length} carriers, names ${names.length}`).toBe(
        carriers.length
      );
      for (const n of names) {
        expect(n.trim(), `${config.id} left an end unnamed`).not.toBe('');
      }
    }
  });

  it('⚑ is not vacuous - some type really does carry error on two ends', () => {
    const many = ALL_AXES_TYPE_CONFIGS.filter((c) => (c.errorValueSlots ?? [0]).length > 1);
    expect(many.map((c) => c.id), 'the case this rule exists for').toContain('span');
  });

  it('⚑ and it names them the way the TABLE names them, so nothing has two words', () => {
    const span = ALL_AXES_TYPE_CONFIGS.find((c) => c.id === 'span')!;
    const s = new CalibrationSession<CalibratedAxes>(span as never);
    expect(s.getErrorCarrierNames()).toEqual([...s.getValueColumns()]);
  });
});
