import "./PelicanRidePage.css";

/**
 * Animated SVG of a pelican pedaling a bicycle through a scrolling desert.
 *
 * Design notes (kept here to make future tweaks easier):
 * - The scene uses three parallax layers (far dunes, mid dunes, foreground
 *   cacti/rocks) that scroll right-to-left at different speeds while the
 *   pelican stays centred — giving the illusion of forward motion.
 * - The pedal crank rotates around the bottom bracket; each pedal
 *   counter-rotates so it stays horizontal.
 * - The pelican's legs are drawn as quadratic Bézier paths whose control
 *   point (the "knee") is computed via two-bone inverse kinematics so the
 *   hip stays anchored to the body and the foot stays glued to the pedal,
 *   without distortion. The 12 keyframes below were precomputed from that
 *   IK solution for a hip at (385, 235), pedal centre (400, 295) with
 *   radius 18, and total leg length 75.
 */

const LEFT_LEG_VALUES = [
  "M 385,235 Q 388.10,272.37 418.00,295.00",
  "M 385,235 Q 399.73,269.75 415.59,304.00",
  "M 385,235 Q 396.42,272.98 409.00,310.59",
  "M 385,235 Q 391.90,274.12 400.00,313.00",
  "M 385,235 Q 387.39,272.84 391.00,310.59",
  "M 385,235 Q 370.01,269.37 384.41,304.00",
  "M 385,235 Q 361.08,263.88 382.00,295.00",
  "M 385,235 Q 357.21,260.18 384.41,286.00",
  "M 385,235 Q 358.20,261.23 391.00,279.41",
  "M 385,235 Q 364.11,266.14 400.00,277.00",
  "M 385,235 Q 372.60,270.39 409.00,279.41",
  "M 385,235 Q 380.70,272.25 415.59,286.00",
  "M 385,235 Q 388.10,272.37 418.00,295.00",
].join(";");

const RIGHT_LEG_VALUES = [
  "M 385,235 Q 361.08,263.88 382.00,295.00",
  "M 385,235 Q 357.21,260.18 384.41,286.00",
  "M 385,235 Q 358.20,261.23 391.00,279.41",
  "M 385,235 Q 364.11,266.14 400.00,277.00",
  "M 385,235 Q 372.60,270.39 409.00,279.41",
  "M 385,235 Q 380.70,272.25 415.59,286.00",
  "M 385,235 Q 388.10,272.37 418.00,295.00",
  "M 385,235 Q 399.73,269.75 415.59,304.00",
  "M 385,235 Q 396.42,272.98 409.00,310.59",
  "M 385,235 Q 391.90,274.12 400.00,313.00",
  "M 385,235 Q 387.39,272.84 391.00,310.59",
  "M 385,235 Q 370.01,269.37 384.41,304.00",
  "M 385,235 Q 361.08,263.88 382.00,295.00",
].join(";");

// Pedaling cadence (seconds per full revolution). All leg/wheel/pedal
// animations share this so the joints stay perfectly in sync.
const PEDAL_PERIOD = "1.6s";

function FarDunes({ offsetX = 0 }: { offsetX?: number }) {
  return (
    <g transform={`translate(${offsetX}, 0)`}>
      <path
        d="M0,260 Q120,210 240,235 T480,230 T720,240 T960,225 L960,400 L0,400 Z"
        fill="#e6a55a"
      />
    </g>
  );
}

function MidDunes({ offsetX = 0 }: { offsetX?: number }) {
  return (
    <g transform={`translate(${offsetX}, 0)`}>
      <path
        d="M0,290 Q160,250 320,275 T640,275 T960,265 L960,400 L0,400 Z"
        fill="#d18a3c"
      />
    </g>
  );
}

function Cactus({ x, scale = 1 }: { x: number; scale?: number }) {
  return (
    <g transform={`translate(${x}, 320) scale(${scale})`}>
      <path
        d="M0,0 L0,-55 Q0,-65 8,-65 Q16,-65 16,-55 L16,0 Z"
        fill="#3f7a3a"
      />
      <path
        d="M2,-30 L2,-45 Q2,-52 -6,-52 Q-12,-52 -12,-44 L-12,-22 Q-12,-15 -6,-15 L2,-15 Z"
        fill="#3f7a3a"
      />
      <path
        d="M14,-38 L14,-50 Q14,-57 22,-57 Q28,-57 28,-49 L28,-30 Q28,-23 22,-23 L14,-23 Z"
        fill="#3f7a3a"
      />
    </g>
  );
}

function Rock({ x, y = 335, w = 22 }: { x: number; y?: number; w?: number }) {
  return (
    <ellipse cx={x} cy={y} rx={w} ry={w * 0.45} fill="#a86f3d" />
  );
}

function ForegroundLayer({ offsetX = 0 }: { offsetX?: number }) {
  return (
    <g transform={`translate(${offsetX}, 0)`}>
      <Cactus x={60} scale={1.1} />
      <Rock x={180} w={18} />
      <Cactus x={290} scale={0.85} />
      <Rock x={400} w={26} y={338} />
      <Cactus x={520} scale={1.2} />
      <Rock x={680} w={16} />
      <Cactus x={820} scale={0.95} />
      <Rock x={920} w={20} />
    </g>
  );
}

export default function PelicanRidePage() {
  return (
    <div className="pelican-ride-page">
      <h1>🚲 Pelican Desert Ride</h1>
      <p className="pelican-ride-caption">
        A pelican pedals tirelessly across an endless desert. Joints are
        animated with two-bone inverse kinematics so the legs stay glued to
        the pedals without distortion while the parallax background scrolls.
      </p>

      <div className="pelican-ride-stage">
        <svg
          viewBox="0 0 800 400"
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-label="Animated pelican riding a bicycle through the desert"
        >
          <defs>
            <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fbe3a2" />
              <stop offset="60%" stopColor="#f6c477" />
              <stop offset="100%" stopColor="#e89b56" />
            </linearGradient>

            <radialGradient id="sun" cx="0.5" cy="0.5" r="0.5">
              <stop offset="0%" stopColor="#fff5c2" />
              <stop offset="60%" stopColor="#ffd166" />
              <stop offset="100%" stopColor="#ffd166" stopOpacity="0" />
            </radialGradient>

            {/* Reusable spoke pattern */}
            <g id="spokes">
              <line x1="-38" y1="0" x2="38" y2="0" stroke="#222" strokeWidth="1.5" />
              <line x1="0" y1="-38" x2="0" y2="38" stroke="#222" strokeWidth="1.5" />
              <line x1="-27" y1="-27" x2="27" y2="27" stroke="#222" strokeWidth="1.5" />
              <line x1="-27" y1="27" x2="27" y2="-27" stroke="#222" strokeWidth="1.5" />
            </g>
          </defs>

          {/* Sky */}
          <rect x="0" y="0" width="800" height="400" fill="url(#sky)" />
          <circle cx="640" cy="90" r="55" fill="url(#sun)" />
          <circle cx="640" cy="90" r="32" fill="#fff1b5" />

          {/* Far dunes (slow scroll) — two copies tiled, group animated -960 -> 0 */}
          <g>
            <FarDunes offsetX={0} />
            <FarDunes offsetX={960} />
            <animateTransform
              attributeName="transform"
              type="translate"
              from="0 0"
              to="-960 0"
              dur="22s"
              repeatCount="indefinite"
            />
          </g>

          {/* Mid dunes (medium scroll) */}
          <g>
            <MidDunes offsetX={0} />
            <MidDunes offsetX={960} />
            <animateTransform
              attributeName="transform"
              type="translate"
              from="0 0"
              to="-960 0"
              dur="12s"
              repeatCount="indefinite"
            />
          </g>

          {/* Ground line */}
          <rect x="0" y="345" width="800" height="55" fill="#c97a35" />

          {/* Foreground cacti & rocks (fast scroll) */}
          <g>
            <ForegroundLayer offsetX={0} />
            <ForegroundLayer offsetX={960} />
            <animateTransform
              attributeName="transform"
              type="translate"
              from="0 0"
              to="-960 0"
              dur="6s"
              repeatCount="indefinite"
            />
          </g>

          {/* Pelican + bike: gentle vertical bob in time with the pedalling */}
          <g>
            <animateTransform
              attributeName="transform"
              type="translate"
              values="0 0; 0 -2; 0 0; 0 -2; 0 0"
              dur={PEDAL_PERIOD}
              repeatCount="indefinite"
            />

            {/* ---------- Bicycle ---------- */}
            {/* Wheels */}
            <g transform="translate(280, 310)">
              <circle r="42" fill="none" stroke="#222" strokeWidth="4" />
              <circle r="6" fill="#444" />
              <g>
                <use href="#spokes" />
                <animateTransform
                  attributeName="transform"
                  type="rotate"
                  from="0"
                  to="360"
                  dur={PEDAL_PERIOD}
                  repeatCount="indefinite"
                />
              </g>
            </g>
            <g transform="translate(520, 310)">
              <circle r="42" fill="none" stroke="#222" strokeWidth="4" />
              <circle r="6" fill="#444" />
              <g>
                <use href="#spokes" />
                <animateTransform
                  attributeName="transform"
                  type="rotate"
                  from="0"
                  to="360"
                  dur={PEDAL_PERIOD}
                  repeatCount="indefinite"
                />
              </g>
            </g>

            {/* Frame: down tube, seat tube, top tube, chain stay, seat stay, fork */}
            <g stroke="#c0392b" strokeWidth="6" strokeLinecap="round" fill="none">
              {/* Bottom bracket at (400, 295) */}
              <line x1="400" y1="295" x2="280" y2="310" /> {/* chain stay */}
              <line x1="400" y1="295" x2="520" y2="310" /> {/* down tube to front hub via fork base */}
              <line x1="400" y1="295" x2="350" y2="225" /> {/* seat tube */}
              <line x1="350" y1="225" x2="280" y2="310" /> {/* seat stay */}
              <line x1="350" y1="225" x2="500" y2="220" /> {/* top tube */}
              <line x1="500" y1="220" x2="520" y2="310" /> {/* fork */}
              <line x1="500" y1="220" x2="510" y2="195" /> {/* head/stem */}
            </g>

            {/* Handlebar */}
            <g stroke="#222" strokeWidth="4" strokeLinecap="round" fill="none">
              <path d="M 510,195 Q 520,185 535,190" />
              <path d="M 510,195 Q 500,205 488,200" />
            </g>

            {/* Seat */}
            <ellipse cx="350" cy="220" rx="14" ry="5" fill="#222" />

            {/* Chainring */}
            <circle cx="400" cy="295" r="12" fill="none" stroke="#444" strokeWidth="2" />
            <circle cx="400" cy="295" r="3" fill="#222" />

            {/* ---------- Pedal crank ---------- */}
            {/* The crank arm group rotates; each pedal counter-rotates to stay flat. */}
            <g transform="translate(400, 295)">
              <g>
                <animateTransform
                  attributeName="transform"
                  type="rotate"
                  from="0"
                  to="360"
                  dur={PEDAL_PERIOD}
                  repeatCount="indefinite"
                />
                {/* Crank arm */}
                <line
                  x1="-18"
                  y1="0"
                  x2="18"
                  y2="0"
                  stroke="#333"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                />
                {/* Right-side pedal — counter-rotates so it stays level */}
                <g transform="translate(18, 0)">
                  <g>
                    <animateTransform
                      attributeName="transform"
                      type="rotate"
                      from="0"
                      to="-360"
                      dur={PEDAL_PERIOD}
                      repeatCount="indefinite"
                    />
                    <rect x="-7" y="-2" width="14" height="4" rx="1.5" fill="#222" />
                  </g>
                </g>
                {/* Left-side pedal */}
                <g transform="translate(-18, 0)">
                  <g>
                    <animateTransform
                      attributeName="transform"
                      type="rotate"
                      from="0"
                      to="-360"
                      dur={PEDAL_PERIOD}
                      repeatCount="indefinite"
                    />
                    <rect x="-7" y="-2" width="14" height="4" rx="1.5" fill="#222" />
                  </g>
                </g>
              </g>
            </g>

            {/* ---------- Pelican ---------- */}
            {/* Tail */}
            <path d="M 305,205 Q 290,200 285,215 Q 295,218 312,212 Z" fill="#f5f5f5" stroke="#bbb" strokeWidth="1" />

            {/* Body */}
            <ellipse cx="360" cy="215" rx="55" ry="32" fill="#fafafa" stroke="#bbb" strokeWidth="1.5" />
            {/* Wing (folded, gripping handlebar) */}
            <path
              d="M 360,205 Q 410,195 470,205 Q 475,215 470,220 Q 420,222 365,225 Z"
              fill="#ececec"
              stroke="#bbb"
              strokeWidth="1.2"
            />
            {/* Wing tip resting on handlebar at ~(488,200) */}
            <ellipse cx="486" cy="206" rx="8" ry="4" fill="#ececec" stroke="#bbb" strokeWidth="1" />

            {/* Neck */}
            <path
              d="M 395,195 Q 415,165 435,160 Q 442,158 445,165 Q 432,175 415,200 Z"
              fill="#fafafa"
              stroke="#bbb"
              strokeWidth="1.2"
            />

            {/* Head */}
            <circle cx="445" cy="158" r="18" fill="#fafafa" stroke="#bbb" strokeWidth="1.5" />
            {/* Eye */}
            <circle cx="452" cy="153" r="2.4" fill="#222" />
            <circle cx="453" cy="152" r="0.8" fill="#fff" />

            {/* Beak — long pelican bill with pouch */}
            <path
              d="M 460,158 Q 510,148 520,160 Q 510,164 462,166 Z"
              fill="#ffb347"
              stroke="#cf8420"
              strokeWidth="1.2"
            />
            <path
              d="M 462,166 Q 490,178 515,168 Q 502,172 462,170 Z"
              fill="#ffcb73"
              stroke="#cf8420"
              strokeWidth="1"
            />
            {/* Beak parting line */}
            <path d="M 460,162 Q 488,162 518,161" stroke="#cf8420" strokeWidth="0.8" fill="none" />

            {/* Little head crest */}
            <path d="M 438,142 Q 442,134 448,140" stroke="#bbb" strokeWidth="1.5" fill="none" />

            {/* ---------- Legs (IK-driven, perfect joints) ---------- */}
            {/* Hip joint marker (kept under legs so leg paint covers it) */}
            <circle cx="385" cy="235" r="3.5" fill="#ffb347" />

            {/* Right (far-side) leg drawn first so left leg sits on top */}
            <path
              d=""
              fill="none"
              stroke="#e89b3a"
              strokeWidth="5"
              strokeLinecap="round"
            >
              <animate
                attributeName="d"
                values={RIGHT_LEG_VALUES}
                dur={PEDAL_PERIOD}
                repeatCount="indefinite"
                calcMode="linear"
              />
            </path>

            {/* Left (near-side) leg */}
            <path
              d=""
              fill="none"
              stroke="#ffb347"
              strokeWidth="5.5"
              strokeLinecap="round"
            >
              <animate
                attributeName="d"
                values={LEFT_LEG_VALUES}
                dur={PEDAL_PERIOD}
                repeatCount="indefinite"
                calcMode="linear"
              />
            </path>

            {/* Foot markers — small webbed feet that orbit with the pedals */}
            <g transform="translate(400, 295)">
              <g>
                <animateTransform
                  attributeName="transform"
                  type="rotate"
                  from="0"
                  to="360"
                  dur={PEDAL_PERIOD}
                  repeatCount="indefinite"
                />
                {/* Near foot at +18 */}
                <g transform="translate(18, 0)">
                  <g>
                    <animateTransform
                      attributeName="transform"
                      type="rotate"
                      from="0"
                      to="-360"
                      dur={PEDAL_PERIOD}
                      repeatCount="indefinite"
                    />
                    <ellipse cx="0" cy="2" rx="7" ry="3" fill="#ffb347" stroke="#cf8420" strokeWidth="0.8" />
                  </g>
                </g>
                {/* Far foot at -18 */}
                <g transform="translate(-18, 0)">
                  <g>
                    <animateTransform
                      attributeName="transform"
                      type="rotate"
                      from="0"
                      to="-360"
                      dur={PEDAL_PERIOD}
                      repeatCount="indefinite"
                    />
                    <ellipse cx="0" cy="2" rx="6" ry="2.5" fill="#e89b3a" stroke="#cf8420" strokeWidth="0.8" />
                  </g>
                </g>
              </g>
            </g>
          </g>

          {/* Heat-haze shimmer near the horizon */}
          <rect x="0" y="240" width="800" height="6" fill="#ffffff" opacity="0.08">
            <animate
              attributeName="opacity"
              values="0.04;0.12;0.04"
              dur="3s"
              repeatCount="indefinite"
            />
          </rect>
        </svg>
      </div>
    </div>
  );
}
