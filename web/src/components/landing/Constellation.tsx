/**
 * The constellation motif: a few points joined by thin lines. It is decorative,
 * so it is hidden from assistive technology. Animations address nodes by
 * their data-node index and edges by their class, inside a scoped context.
 *
 * Positions are fixed in a 400 by 400 viewBox. Nothing here is generated from
 * user data.
 */

const NODES: ReadonlyArray<{ x: number; y: number; accent?: boolean }> = [
  { x: 200, y: 200, accent: true },
  { x: 92, y: 118 },
  { x: 318, y: 96 },
  { x: 334, y: 250 },
  { x: 122, y: 306 },
  { x: 256, y: 334 },
  { x: 58, y: 222 },
];

const EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [0, 2],
  [0, 3],
  [0, 4],
  [0, 5],
  [1, 6],
  [6, 4],
  [2, 3],
  [3, 5],
];

export function Constellation() {
  return (
    <svg className="constellation" viewBox="0 0 400 400" aria-hidden="true" focusable="false">
      <circle className="constellation__halo" cx={200} cy={200} r={74} />
      {EDGES.map(([from, to]) => {
        const a = NODES[from];
        const b = NODES[to];
        if (!a || !b) {
          return null;
        }
        // pathLength="1" lets the stroke be drawn in and out with a unit dash.
        return (
          <path
            key={`${from}-${to}`}
            className="constellation__edge"
            d={`M${a.x} ${a.y} L${b.x} ${b.y}`}
            pathLength={1}
          />
        );
      })}
      {NODES.map((node, index) => (
        <circle
          key={index}
          data-node={index}
          className={node.accent ? "constellation__node constellation__node--accent" : "constellation__node"}
          cx={node.x}
          cy={node.y}
          r={node.accent ? 9 : 5.5}
        />
      ))}
    </svg>
  );
}
