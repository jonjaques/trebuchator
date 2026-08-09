# Trebuchator

Trebuchator models a counterweight trebuchet end to end and reports what it would
actually do — range, release, structural loads, and where the energy went. The
vocabulary is the one a builder already has; the software adopts it rather than the
reverse.

## Language

### The machine

**Machine**:
One complete trebuchet, defined entirely by its numbers.
_Avoid_: design, build, configuration, setup, params

**Hinged**:
A machine whose counterweight hangs from the short arm on its own hinge and swings as
a second pendulum.
_Avoid_: swinging, classic, medieval

**Bolted**:
A machine whose counterweight is rigid on the short arm, dragged through an arc rather
than falling.
_Avoid_: fixed, rigid, static

**Floating arm**:
A machine whose axle rolls along a rail while the counterweight drops straight down a
channel.
_Avoid_: FAT, rolling, tracked

**Beam**:
The single lever the machine turns on, carrying the counterweight at one end and the
sling at the other.
_Avoid_: arm (unqualified), throwing arm, lever

**Long arm** / **Short arm**:
The two sides of the beam measured from the axle — the long arm throws, the short arm
carries the counterweight. "Arm" is never used unqualified.
_Avoid_: throwing arm, weight arm, butt

**Axle**:
The shaft the beam turns on — the part a builder buys, sizes and greases. It has a
radius and a friction coefficient and carries the machine's largest load. On a floating
arm it rolls along the rail.
_Avoid_: main bearing, hub, pin

**Pivot**:
The point the beam turns about. It sits at the axle on every machine, so the two words
name a point and a part rather than two places — the beam turns about the pivot, and the
load is carried by the axle.
_Avoid_: fulcrum, centre of rotation, hinge

**Counterweight**:
The falling mass that drives the machine, modelled and drawn as a box.
_Avoid_: cw (in prose), weight (alone), ballast, bob

**Hanger**:
The strap or link from the short arm to the counterweight's centre of gravity, about
which a hinged counterweight swings. On a bolted machine the same dimension is a
**standoff** — it holds the weight off the arm but cannot swing.
_Avoid_: strap, drop, tether

**Sling**:
The cord from the beam tip to the pouch.
_Avoid_: strap, cord, line

**Pouch**:
The cradle at the end of the sling that carries the projectile.
_Avoid_: cup, basket, net

**Pin**:
The finger on the beam tip that the loose sling loop slips off.
_Avoid_: spigot, finger, hook, prong

**Pin angle**:
The angle between the long arm and the sling at the instant the loop leaves the pin —
the number a builder bends steel to.
_Avoid_: release angle, spigot angle, gamma

**Trough**:
The rail the projectile slides along before liftoff. Zero height is bare ground.
_Avoid_: rail, track, channel, guide, chute

**Rail**:
The horizontal track a floating arm's axle rolls along. Reserved for that — the
projectile's is always the trough, and the app's side panels are layout, not domain.
_Avoid_: track, way

**Channel**:
The vertical guide a floating arm's counterweight drops through.
_Avoid_: chute, shaft, slot

**Cocked**:
The machine at rest before firing, long arm down and beam tip resting on the trough. The
**cocked angle** is the beam angle at that pose.
_Avoid_: initial angle, start angle, loaded, armed

### The shot

**Shot**:
One firing, from the beam being let go to impact. A shot is an event — it has a
timeline, an outcome and a set of loads. Never an object.
_Avoid_: throw, launch, run, fire

**Projectile**:
The object that flies.
_Avoid_: shot, stone, payload, ball, missile

**Stroke**:
The mechanical part of a shot — the beam driving the projectile — ending at release.
_Avoid_: swing (for the whole of it), throw, cycle

**Stroke phase**:
What the *machine* is doing: ground while the projectile is dragged along the trough,
swing from liftoff to release, follow afterwards.
_Avoid_: phase (unqualified), stage, mode

**Shot phase**:
Where the *shot* is on its clock: ground, swing, flight, landed. It shares two names
with stroke phase and differs in subject, so neither is ever called just "phase".
_Avoid_: phase (unqualified), state, stage

**Liftoff**:
The instant the trough stops carrying the projectile and the sling takes it — where the
trough's normal force passes through zero.
_Avoid_: takeoff, separation, lift

**Release**:
The instant the sling lets go. Also the end of the stroke.
_Avoid_: launch, let-go, escape, loose

**Follow-through**:
The beam and counterweight continuing past release with an empty pouch. Cosmetic —
nothing measured is read from it.
_Avoid_: overrun, coast, after-swing

**Flight**:
Release to impact, the projectile alone against gravity and air.
_Avoid_: ballistic phase, arc

**Trajectory**:
The path the projectile takes through the flight.
_Avoid_: arc, path, curve

**Carry**:
Ground distance travelled after release only.
_Avoid_: throw distance, flight distance

**Range**:
Ground distance from the machine to the impact point. The headline number.
_Avoid_: distance, throw, reach

**Efficiency**:
Projectile kinetic energy at release as a fraction of the potential energy the machine
gave up.
_Avoid_: yield, effectiveness, conversion

**Energy budget**:
The full account of where a stroke's available energy went — projectile, beam,
counterweight, sling, lift, friction, drag, and what was never cashed in. It has to
close.
_Avoid_: energy breakdown, losses, accounting

### Reading a machine

**Sheet**:
The drawing surface: the machine, its trajectory, dimensions and annotations, drawn the
way a workshop drawing is.
_Avoid_: canvas, stage, view, diagram, scene

**Ghost**:
A second machine and trajectory drawn faintly on the sheet for comparison. Saved shots
are lettered ghosts; a sweep's hovered machine is an unlettered one.
_Avoid_: overlay, trace, shadow, phantom

**Sweep**:
Firing one parameter across a range of values to see how the machine responds. Labelled
"What if" where the reader sees it.
_Avoid_: scan, parameter study, series

**As built** / **Best case**:
The two readings of a sweep. As built changes one number and nothing else. Best case
re-cocks the beam and releases ideally at every point, answering what a dimension could
give rather than what the machine in hand does with it.
_Avoid_: raw/tuned, actual/ideal, current/optimal

**Frontier**:
The set of machines that are not beaten on both range and peak axle load at once — what
the optimizer offers instead of a single "best".
_Avoid_: optimum, best, results, solutions

**Preset**:
A named starting machine drawn from a real one.
_Avoid_: template, example, sample, default
