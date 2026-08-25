insert into public.exercise_library (
  canonical_name,
  aliases,
  movement_pattern,
  primary_muscles,
  secondary_muscles
)
values
  ('Barbell Bench Press', array['bench press', 'barbell bench'], 'horizontal_push', array['chest'], array['triceps', 'front_delts']),
  ('Back Squat', array['squat', 'barbell squat'], 'squat', array['quadriceps', 'glutes'], array['hamstrings', 'core']),
  ('Conventional Deadlift', array['deadlift'], 'hinge', array['hamstrings', 'glutes', 'back'], array['forearms', 'core']),
  ('Lat Pulldown', array['lat pull down'], 'vertical_pull', array['lats'], array['biceps', 'upper_back'])
on conflict (canonical_name) do nothing;
