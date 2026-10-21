-- Personal car (flag personalCar, GTA V critique #20 "nothing persists"): the last car a device drove and left, so it is
-- still parked there next session. One row per funding device; pose in signed centimetres + the byte yaw, like the wire.
CREATE TABLE IF NOT EXISTS personal_cars (
  device_id TEXT PRIMARY KEY,
  kind      TEXT NOT NULL,
  x         INTEGER NOT NULL,
  y         INTEGER NOT NULL,
  z         INTEGER NOT NULL,
  yaw       INTEGER NOT NULL,
  saved_at  INTEGER NOT NULL
);
