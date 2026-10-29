// Turns the print-ready HTML documents in the repo root into structured JSON
// for the site, and copies the PDFs and their cover images into public/.
// Run: npm run extract   (EDITION=student leaves out every mentor PDF)
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, statSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(SITE, '..');
const OUT = join(SITE, 'src/data/generated');
const PDF_OUT = join(SITE, 'public/pdf');
const COVER_OUT = join(SITE, 'public/covers');
// First-page previews, rendered once with pdftoppm and committed.
const COVER_SRC = join(SITE, 'covers');
const STUDENT = process.env.EDITION === 'student';

const SOURCES = {
  plan: 'AI-Discover-Individual-Plan-hy.html',
  course: 'AI-Discover-Course-hy-mentor.html',
  guideHy: 'Mentor-Guide-AI-Discover-hy.html',
  guideRu: 'Mentor-Guide-AI-Discover-ru.html',
  tips: 'Mentor-Tips-AI-Discover-hy.html',
};

const PDFS = [
  { slug: 'plan', file: 'AI-Discover-Individual-Plan-hy.pdf', mentor: false },
  { slug: 'course', file: 'AI-Discover-Course-hy.pdf', mentor: false },
  { slug: 'course-mentor', file: 'AI-Discover-Course-hy-mentor.pdf', mentor: true },
  { slug: 'mentor-guide', file: 'Mentor-Guide-AI-Discover-hy.pdf', mentor: true },
  { slug: 'mentor-guide-ru', file: 'Mentor-Guide-AI-Discover-ru.pdf', mentor: true },
  { slug: 'mentor-tips', file: 'Mentor-Tips-AI-Discover-hy.pdf', mentor: true },
];

const load = (file) => {
  const $ = cheerio.load(readFileSync(join(ROOT, file), 'utf8'), { decodeEntities: false });
  // Highlight the [fill-in] slots inside prompts.
  $('.pr').each((_, p) => {
    $(p).html($(p).html().replace(/\[([^\]<]{1,200})\]/g, '<mark class="slot">[$1]</mark>'));
  });
  return $;
};
const clean = (s) => s.replace(/\s+/g, ' ').trim();
const text = ($el) => clean($el.text());
// Tables get a wrapper so they can scroll sideways on small screens.
const wrapTables = (h) => h.replace(/<table/g, '<div class="table-wrap"><table').replace(/<\/table>/g, '</table></div>');
const html = ($el) => wrapTables(($el.html() || '').trim());

function cover($) {
  const $c = $('section.cover').first();
  return {
    brand: text($c.find('.brand')),
    title: clean($c.find('h1').html().replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '')),
    sub: text($c.find('.sub').first()),
    meta: $c.find('.meta > div').map((_, d) => ({ k: text($(d).find('.k')), v: text($(d).find('.v')) })).get(),
  };
}

// A long document rendered as one article: every h2 gets an id and a TOC entry.
function article($, prefix) {
  const toc = [];
  $('body > section').not('.cover').each((_, sec) => {
    $(sec).find('h2').each((i, h) => {
      const id = `${prefix}-${toc.length + 1}`;
      $(h).attr('id', id);
      const kicker = text($(h).prevAll('.sec').first());
      toc.push({ id, title: text($(h)), kicker });
    });
  });
  const parts = $('body > section').not('.cover').map((_, sec) => `<section class="doc-part">${html($(sec))}</section>`).get();
  return { toc, html: parts.join('\n') };
}

// ---------------------------------------------------------------- tools
const TOOL_GROUPS = [
  ['Ընդհանուր AI', ['ChatGPT', 'Claude', 'Gemini', 'Perplexity', 'NotebookLM']],
  ['Աղյուսակներ և ֆինանսներ', ['Google Sheets', 'Excel']],
  ['Փաստաթղթեր', ['Google Docs', 'Word', 'Google Drive']],
  ['Պատկերներ և դիզայն', ['Midjourney', 'Canva']],
  ['Ներկայացումներ', ['Gamma', 'PowerPoint']],
  ['Վիդեո և անիմացիա', ['CapCut', 'ElevenLabs', 'Veo', 'Runway', 'Kling', 'HeyGen']],
  ['Ավտոմատացում և գիտելիքի բազա', ['Make', 'n8n', 'Notion', 'Gmail', 'Telegram']],
];
const ALIASES = { 'Canva Magic Studio': 'Canva' };

function parseTools(raw) {
  const list = raw
    .replace(/\(կամ ([^)]+)\)/g, ', $1') // "Make (կամ n8n)" -> alternative tool
    .replace(/\([^)]*\)/g, '') // "Veo (Gemini)", "Gmail (թեստային)" -> annotation only
    .split(/,|\sկամ\s/)
    .map((t) => ALIASES[t.trim()] || t.trim())
    .filter(Boolean);
  const all = list.some((t) => t.includes('ամբողջ փաթեթ'));
  const known = new Set(TOOL_GROUPS.flatMap(([, ts]) => ts));
  const tools = [...new Set(list.filter((t) => known.has(t)))];
  const unknown = list.filter((t) => !known.has(t) && !t.includes('ամբողջ փաթեթ') && !t.includes('ըստ նախագծի'));
  if (unknown.length) console.warn('  ! unmapped tools:', unknown.join(', '));
  return { tools, allTools: all };
}

// ---------------------------------------------------------------- plan
function extractPlan() {
  const $ = load(SOURCES.plan);
  const card = (d) => ({ n: text($(d).find('.n')), title: text($(d).find('h4')), text: text($(d).find('p')) });
  const cardSets = $('.cards');
  const phases = $('.block').map((_, b) => {
    const $b = $(b);
    return {
      letter: text($b.find('.tag')),
      title: text($b.find('h3')),
      range: text($b.find('.rng')),
      sessions: $b.next('.sessions').find('.s').map((__, s) => ({
        n: Number(text($(s).find('.num'))),
        title: text($(s).find('h4')),
        bullets: $(s).find('li').map((___, li) => text($(li))).get(),
        result: text($(s).find('.res')).replace(/^Արդյունք՝\s*/, ''),
      })).get(),
    };
  }).get();
  const tables = $('table').not('.cal');
  const rows = ($t) => $t.find('tr').map((_, tr) => [$(tr).find('td').map((__, td) => text($(td))).get()]).get().filter((r) => r.length);

  const data = {
    cover: cover($),
    goals: cardSets.eq(0).find('.card').map((_, d) => card(d)).get(),
    principles: $('.principle > div').map((_, d) => {
      const title = text($(d).find('b'));
      return { title, text: text($(d)).slice(title.length).trim() };
    }).get(),
    months: cardSets.eq(1).find('.card').map((_, d) => card(d)).get(),
    stats: $('.format-strip > div').map((_, d) => ({ big: text($(d).find('.big')), label: text($(d).find('.lbl')) })).get(),
    structure: rows(tables.eq(0)).map(([phase, sessions, weeks, gets]) => ({ phase, sessions, weeks, gets })),
    phases,
    projects: $('.projects > div').map((_, d) => {
      const title = text($(d).find('b'));
      return { title, text: text($(d)).slice(title.length).trim() };
    }).get(),
    outcomes: $('.outcomes li').map((_, li) => text($(li))).get(),
    tools: rows(tables.eq(1)).map(([area, list]) => ({ area, list })),
    format: rows(tables.eq(2)).map(([k, v]) => ({ k, v })),
    price: rows(tables.eq(3)).map(([format, monthly, total, payment]) => ({ format, monthly, total, payment }))[0],
    steps: $('.steps > div').map((_, d) => text($(d)).replace(/^\d+\s*/, '')).get(),
    contact: $('.contact span').map((_, s) => text($(s))).get(),
    article: article($, 'plan'),
  };
  return data;
}

// ---------------------------------------------------------------- course
function extractCourse() {
  const $ = load(SOURCES.course);
  const sections = $('body > section').toArray();
  const out = { cover: cover($), intro: null, phases: [], sessions: [], final: null, appendix: null };

  for (const sec of sections) {
    const $s = $(sec);
    if ($s.hasClass('cover')) continue;

    if ($s.hasClass('ph-cover')) {
      const $rows = $s.find('table').first();
      const phase = {
        letter: text($s.find('.big')),
        title: text($s.find('h2')),
        lead: text($s.find('.lead')),
        rows: $rows.find('tr').toArray().slice(1).map((tr) => {
          const td = $(tr).find('td');
          return { n: Number(text(td.eq(0))), title: text(td.eq(1)), result: text(td.eq(2)) };
        }),
        boxes: $s.find('.box').map((_, b) => {
          const title = text($(b).find('b').first());
          return { kind: ($(b).attr('class') || '').replace('box', '').trim() || 'info', title, text: text($(b)).slice(title.length).trim() };
        }).get(),
      };
      // Anything beyond the summary (e.g. phase B's training bank statement) is kept as HTML.
      $s.find('.big, h2, .lead, .box').remove();
      $rows.remove();
      phase.extra = html($s);
      out.phases.push(phase);
      continue;
    }

    const $sh = $s.find('.sh');
    if (!$sh.length) {
      const title = text($s.find('h2').first());
      $s.find('h2').first().remove();
      $s.find('.sec').first().remove();
      const toc = [];
      const key = out.intro ? (title.includes('Ձևանմուշ') ? 'appendix' : 'final') : 'intro';
      $s.find('h3').each((i, h) => {
        const id = `${key}-${i + 1}`;
        $(h).attr('id', id);
        toc.push({ id, title: text($(h)) });
      });
      out[key] = { title, toc, html: html($s) };
      continue;
    }

    const n = Number(text($sh.find('.num')));
    const ph = text($sh.find('.ph'));
    const [, letter, phaseName, week] = ph.match(/Փուլ ([A-D]) · (.+?) · շաբաթ (\d+)/);
    const mt = text($sh.find('.mt'));
    const { tools, allTools } = parseTools(mt.split('Գործիքներ՝')[1] || '');
    const $goal = $s.find('.goal');
    const goal = clean($goal.children().eq(0).clone().find('.k').remove().end().text());
    const outcomes = $goal.children().eq(1).find('li').map((_, li) => text($(li)).replace(/[,.։]$/, '')).get();

    const $timing = $s.find('table.timing');
    const timing = $timing.find('tr').toArray().slice(1).map((tr) => {
      const td = $(tr).find('td');
      const [from, to] = text(td.eq(0)).split(/[–-]/).map(Number);
      return { from, to, text: text(td.eq(1)) };
    });

    const prompts = $s.find('.pr').map((i, p) => {
      const $p = $(p);
      const label = text($p.find('.t'));
      const [, id = `${n}.${i + 1}`, title = label] = label.match(/Պրոմպտ\s+([\d.]+)\s*·\s*(.+)/) || [];
      const $body = $p.clone();
      $body.find('.t').remove();
      return { id, title, n, phase: letter, html: html($body), text: $body.text().trim() };
    }).get();

    const mentor = $s.find('.m').map((_, m) => html($(m).clone().find('b').first().remove().end())).get();

    // What remains is the session body: ideas, prompts, exercise, homework.
    $sh.remove();
    $goal.remove();
    $timing.prev('h3').remove();
    $timing.remove();
    $s.find('.m').remove();
    const toc = [];
    $s.find('h3').each((i, h) => {
      const id = `s${n}-${i + 1}`;
      $(h).attr('id', id);
      toc.push({ id, title: text($(h)) });
    });
    if ($s.find('.end').length) toc.push({ id: `s${n}-end`, title: 'Հանձնարարություն' });
    $s.find('.end').attr('id', `s${n}-end`);

    out.sessions.push({
      n, phase: letter, phaseName, week: Number(week), title: text($sh.find('h2')),
      duration: Number((mt.match(/(\d+) րոպե/) || [])[1] || 90),
      toolsRaw: (mt.split('Գործիքներ՝')[1] || '').trim(), tools, allTools,
      goal, outcomes, timing, prompts, mentor, toc, html: html($s),
    });
  }

  // The standard 90-minute flow from the intro drives the "session rhythm" chart.
  const $intro = cheerio.load(out.intro.html, { decodeEntities: false }, false);
  out.flow = $intro('table.timing').first().find('tr').toArray().slice(1).map((tr) => {
    const td = $intro(tr).find('td');
    const [from, to] = clean(td.eq(0).text()).split(/[–-]/).map(Number);
    return { from, to, block: clean(td.eq(1).text()), text: clean(td.eq(2).text()) };
  });
  out.rules = $intro('.rules > div').map((_, d) => {
    const title = clean($intro(d).find('b').text());
    return { title: title.replace(/^\d+\s*·\s*/, ''), text: clean($intro(d).text()).slice(title.length).trim() };
  }).get();

  out.template = (() => {
    const $a = cheerio.load(out.appendix.html, { decodeEntities: false }, false);
    const $p = $a('.pr').first();
    const label = clean($p.find('.t').text());
    $p.find('.t').remove();
    return { id: 'Ա', title: label, html: $p.html().trim(), text: $p.text().trim() };
  })();
  out.toolGroups = TOOL_GROUPS.map(([group, list]) => ({ group, tools: list }));
  return out;
}

// ---------------------------------------------------------------- mentor docs
function extractGuide(file, prefix) {
  const $ = load(file);
  // The 90-minute lesson skeleton (section 05) powers a chart on the overview.
  const $h = $('h2').filter((_, h) => /90/.test($(h).text())).first();
  const lesson = $h.nextAll('table.timing').first().find('tr').toArray().slice(1).map((tr) => {
    const td = $(tr).find('td');
    const [from, to] = text(td.eq(0)).split(/[–-]/).map(Number);
    return { from, to, block: text(td.eq(1)), text: text(td.eq(2)) };
  });
  return { cover: cover($), lesson, ...article($, prefix) };
}

function extractTips() {
  const $ = load(SOURCES.tips);
  const prompts = $('.pr').map((i, p) => {
    const $p = $(p);
    const title = text($p.find('.t'));
    const $body = $p.clone();
    $body.find('.t').remove();
    return { id: `Մ${i + 1}`, title: title.replace(/^Պրոմպտ\s*\d*\s*·\s*/, ''), html: html($body), text: $body.text().trim() };
  }).get();
  return { cover: cover($), prompts, ...article($, 'tips') };
}

// ---------------------------------------------------------------- pdfs
function extractPdfs() {
  // Start clean so a student build never ships files left over from a full one.
  for (const dir of [PDF_OUT, COVER_OUT]) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
  }
  mkdirSync(COVER_SRC, { recursive: true });
  let canRender = true;
  try { execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' }); } catch { canRender = false; }
  return PDFS.filter((p) => !(STUDENT && p.mentor)).map(({ slug, file }) => {
    const src = join(ROOT, file);
    copyFileSync(src, join(PDF_OUT, file));
    const buf = readFileSync(src).toString('latin1');
    const pages = (buf.match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
    const cover = join(COVER_SRC, `${slug}.jpg`);
    if (canRender && !existsSync(cover)) {
      execFileSync('pdftoppm', ['-jpeg', '-jpegopt', 'quality=82', '-f', '1', '-l', '1', '-scale-to', '720', '-singlefile', src, cover.replace(/\.jpg$/, '')]);
    }
    if (existsSync(cover)) copyFileSync(cover, join(COVER_OUT, `${slug}.jpg`));
    return { slug, file, pages, bytes: statSync(src).size, cover: existsSync(cover) ? `covers/${slug}.jpg` : null };
  });
}

// ---------------------------------------------------------------- main
mkdirSync(OUT, { recursive: true });
const content = {
  plan: extractPlan(),
  course: extractCourse(),
  guide: { hy: extractGuide(SOURCES.guideHy, 'g'), ru: extractGuide(SOURCES.guideRu, 'gru') },
  tips: extractTips(),
  pdfs: extractPdfs(),
};
writeFileSync(join(OUT, 'content.json'), JSON.stringify(content));

const c = content.course;
console.log(`extract: ${c.sessions.length} sessions, ${c.sessions.reduce((a, s) => a + s.prompts.length, 0)} prompts, ` +
  `${content.guide.hy.toc.length}/${content.guide.ru.toc.length} guide sections, ${content.tips.toc.length} tips sections, ${content.pdfs.length} PDFs`);
