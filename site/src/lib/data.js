// Build-time view over the extracted documents (see scripts/extract.mjs).
import content from '../data/generated/content.json';

// `EDITION=student npm run build` drops every mentor-only page, note and PDF.
export const isStudent = process.env.EDITION === 'student';

const base = import.meta.env.BASE_URL.replace(/\/$/, '');
export const url = (path = '/') => `${base}${path}`;

export const { plan, course, guide, tips } = content;

const planSessions = new Map(plan.phases.flatMap((p) => p.sessions).map((s) => [s.n, s]));

export const sessions = course.sessions.map((s) => ({
  ...s,
  result: planSessions.get(s.n)?.result ?? '',
  bullets: planSessions.get(s.n)?.bullets ?? [],
  href: url(`/course/${s.n}/`),
}));

const range = (xs) => (xs[0] === xs.at(-1) ? `${xs[0]}` : `${xs[0]}–${xs.at(-1)}`);

export const phases = course.phases.map((p) => {
  const own = sessions.filter((s) => s.phase === p.letter);
  const weeks = [...new Set(own.map((s) => s.week))];
  return {
    ...p,
    key: p.letter.toLowerCase(),
    short: own[0].phaseName,
    sessions: own,
    weeks,
    sessionRange: range(own.map((s) => s.n)),
    weekRange: range(weeks),
    planTitle: plan.phases.find((x) => x.letter === p.letter)?.title ?? p.title,
  };
});
export const phaseOf = (letter) => phases.find((p) => p.letter === letter);

export const WEEKS = Math.max(...sessions.map((s) => s.week));

// Tools: grouped as in the plan, ordered by how many sessions use them.
export const toolGroups = course.toolGroups
  .map(({ group, tools }) => ({
    group,
    tools: tools
      .map((name) => ({ name, sessions: sessions.filter((s) => s.tools.includes(name)).map((s) => s.n) }))
      .filter((t) => t.sessions.length)
      .sort((a, b) => b.sessions.length - a.sessions.length),
  }))
  .filter((g) => g.tools.length);
export const allTools = toolGroups.flatMap((g) => g.tools);

export const prompts = sessions.flatMap((s) => s.prompts.map((p) => ({ ...p, session: s })));

export const stripMentor = (html) => (isStudent ? html.replace(/<div class="m">[\s\S]*?<\/div>/g, '') : html);

const fmtSize = (b) => `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} ՄԲ`;
const pdf = (slug) => content.pdfs.find((p) => p.slug === slug);

const DOCS = [
  {
    slug: 'plan', audience: 'student', lang: 'hy', web: '/program/',
    title: plan.cover.title, variant: 'Ծրագիր և պայմաններ', desc: plan.cover.sub,
  },
  {
    slug: 'course', audience: 'student', lang: 'hy', web: '/course/',
    title: 'Ուսումնական նյութեր', variant: 'Ուսանողի տարբերակ', desc: course.cover.sub,
  },
  {
    slug: 'course-mentor', audience: 'mentor', lang: 'hy', web: '/course/',
    title: 'Ուսումնական նյութեր', variant: 'Մենթորի տարբերակ՝ նշումներով', desc: course.cover.sub,
  },
  {
    slug: 'mentor-guide', audience: 'mentor', lang: 'hy', web: '/mentor/guide/',
    title: guide.hy.cover.title, variant: 'Հայերեն', desc: guide.hy.cover.sub,
  },
  {
    slug: 'mentor-guide-ru', audience: 'mentor', lang: 'ru', web: '/mentor/guide/?lang=ru',
    title: guide.ru.cover.title, variant: 'Русский', desc: guide.ru.cover.sub,
  },
  {
    slug: 'mentor-tips', audience: 'mentor', lang: 'hy', web: '/mentor/tips/',
    title: tips.cover.title, variant: 'Հնարքներ և պրոմպտներ', desc: tips.cover.sub,
  },
];

export const docs = DOCS.filter((d) => pdf(d.slug) && (!isStudent || d.audience === 'student')).map((d) => {
  const p = pdf(d.slug);
  return {
    ...d,
    file: p.file,
    pages: p.pages,
    size: fmtSize(p.bytes),
    pdfUrl: url(`/pdf/${p.file}`),
    cover: p.cover ? url(`/${p.cover}`) : null,
    href: url(`/docs/${d.slug}/`),
    webHref: url(d.web),
  };
});

export const stats = {
  sessions: sessions.length,
  weeks: WEEKS,
  phases: phases.length,
  prompts: prompts.length,
  tools: allTools.length,
};
