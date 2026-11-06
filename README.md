# Fairway Friends Golf

Low-poly 3D golf for 2–4 friends in the browser. Play live together, or take your shots whenever you're free: the round waits. No sign-in.

Play: https://john-gustin.github.io/golf/

- A new course is generated for every round (3, 9 or 18 holes). Share a course code to replay the same layout.
- Full 14-club bag, wind, lies, draw/fade and spin, water and out-of-bounds penalties, sloped greens with a putting grid.
- Swing with a mouse drag or a classic 3-click meter (each player picks).
- Farthest from the hole plays first among players who are online. Away players catch up later, with a summary and shot replays.

Each player's progress is stored as a retained message on several free public MQTT brokers (and in the browser), so there is no host and no server to run. `lib/` contains bundled copies of three.js and MQTT.js.
