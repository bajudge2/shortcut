import { destinationName, guidanceFor } from '../lib/guidance.ts';
import type { DirectionStep, GraphNode, Route } from '../lib/types.ts';
import ArrivalCard from './ArrivalCard.tsx';

interface Props {
  positionKnown: boolean;
  destNode: GraphNode | undefined;
  route: Route | null;
  steps: DirectionStep[];
  accessible: boolean;
  arrival: { shown: boolean; appearance: number };
  onDone: () => void;
}

// Owns the hint / no-route / route summary / steps / arrival block. A single
// guidanceFor() value drives the output, so at most one hint shows (Req 7.7).
export default function RouteGuidance({ positionKnown, destNode, route, steps, accessible, arrival, onDone }: Props) {
  const destName = destNode ? destinationName(destNode) : null;
  const g = guidanceFor({ positionKnown, destName, hasRoute: !!route, arrived: arrival.shown });

  let body = null;
  switch (g.kind) {
    case 'needPosition':
      body = <p className="hint">Turn on Bluetooth, or tap a place on the map and choose “I’m here”.</p>;
      break;
    case 'needPositionForDest':
      body = (
        <>
          <p className="dest-name">{g.destName}</p>
          <p className="hint">Tap where you are on the map and choose “I’m here”.</p>
        </>
      );
      break;
    case 'needDest':
      body = <p className="hint">Choose a destination above, or tap a room and choose “Navigate here”.</p>;
      break;
    case 'noRoute':
      body = (
        <>
          <p className="dest-name">{g.destName}</p>
          <p className="warn">No route found{accessible ? ' (try turning off accessible routing)' : ''}.</p>
        </>
      );
      break;
    case 'route':
      // guidanceFor only yields 'route' when hasRoute is true
      body = route && (
        <>
          <p className="dest-name">{g.destName}</p>
          <p className="summary">{Math.round(route.distanceMeters)} m · ~{Math.max(1, Math.round(route.distanceMeters / 80))} min</p>
          <ol className="steps">
            {steps.map((s, i) => (
              <li key={i} className={i === 0 ? 'now' : ''}>
                {s.text}{s.distanceMeters > 0 ? ` — ${s.distanceMeters} m` : ''}
              </li>
            ))}
          </ol>
        </>
      );
      break;
    case 'arrived':
      break; // ArrivalCard takes the place of the turn-by-turn list (Req 6.1)
  }

  return (
    <>
      {body}
      <ArrivalCard
        visible={g.kind === 'arrived'}
        destName={g.kind === 'arrived' ? g.destName : (destName ?? '')}
        appearance={arrival.appearance}
        onDone={onDone}
      />
    </>
  );
}
