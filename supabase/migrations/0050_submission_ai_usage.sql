alter table public.submissions
  add column if not exists ai_used boolean;

comment on column public.submissions.ai_used
is 'Whether the applicant used AI in album or music video creation/materials.';
