/**
 * Commands exposing the pure measurement calculators (RTV-27 epic) so modes /
 * toolbars / annotation tools can compute HU stats, Cobb angle, Agatston score
 * and SUVbw. Framework-free (no `@ohif/core`). The viewport layer supplies the
 * ROI pixels / line points / lesions (integration follow-up).
 */
import {
  huStats,
  cobbAngle,
  agatstonScore,
  suvBwFactor,
  suvStats,
  Point,
  CalciumLesion,
  SuvFactorParams,
} from './measurements';

export function getCommandsModule() {
  const actions = {
    computeHuStats: ({ values }: { values: number[] }) => huStats(values ?? []),
    computeCobbAngle: ({ line1, line2 }: { line1: [Point, Point]; line2: [Point, Point] }) => cobbAngle(line1, line2),
    computeAgatston: ({ lesions }: { lesions: CalciumLesion[] }) => agatstonScore(lesions ?? []),
    computeSuvBw: ({ values, ...params }: { values: number[] } & SuvFactorParams) => {
      const factor = suvBwFactor(params);
      return factor == null ? null : suvStats(values ?? [], factor);
    },
  };

  const definitions = {
    computeHuStats: { commandFn: actions.computeHuStats },
    computeCobbAngle: { commandFn: actions.computeCobbAngle },
    computeAgatston: { commandFn: actions.computeAgatston },
    computeSuvBw: { commandFn: actions.computeSuvBw },
  };

  return { actions, definitions, defaultContext: 'DEFAULT' };
}

export default getCommandsModule;
