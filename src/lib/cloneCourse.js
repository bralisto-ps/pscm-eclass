import { run, supabase } from './supabase.js';
import { parseCourseMeta, serializeCourseMeta } from './courseMeta.js';

const QUESTION_FIELDS = [
  'position',
  'kind',
  'prompt',
  'options',
  'answer',
  'params',
  'formula',
  'unit',
  'decimals',
  'tolerance',
  'tolerance_type',
  'marks',
  'explanation',
  'topic',
];

export async function cloneCourse({
  sourceCourse,
  code,
  title,
  semester,
  color,
  includeMaterials = true,
  includeQuizzes = true,
  includeAssignments = true,
  includeCA = true,
}) {
  const cleanCode = String(code || '').trim().toUpperCase();
  const cleanTitle = String(title || '').trim();
  const cleanSemester = String(semester || '').trim();
  if (!cleanCode || !cleanTitle) throw new Error('Enter both a course code and title.');

  const fullSource = await run(supabase.from('courses').select('*').eq('id', sourceCourse.id).single());
  const meta = parseCourseMeta(fullSource);
  const initialCaConfig = includeCA
    ? { ...meta.ca_config }
    : { ca1_weight: 20, ca2_weight: 20, ca1_components: [], ca2_components: [] };
  const cleanDescription = serializeCourseMeta(meta.about || '', initialCaConfig, {
    released: false,
    scores: {},
  });

  // 1. Create the new course shell
  const newCourse = await run(
    supabase
      .from('courses')
      .insert({
        code: cleanCode,
        title: cleanTitle,
        semester: cleanSemester,
        description: cleanDescription,
        color: color || fullSource.color || '#0E6B63',
        archived: false,
        ca_total: fullSource.ca_total ?? 40,
        ca_decimals: fullSource.ca_decimals ?? 0,
        ca_released: false,
      })
      .select()
      .single()
  );

  // 2. Clone modules & materials
  const moduleMap = new Map();
  if (includeMaterials) {
    const [modules, materials] = await Promise.all([
      run(supabase.from('modules').select('*').eq('course_id', sourceCourse.id).order('position').order('created_at')),
      run(supabase.from('materials').select('*').eq('course_id', sourceCourse.id).order('position').order('created_at')),
    ]);

    for (const m of modules) {
      const inserted = await run(
        supabase
          .from('modules')
          .insert({
            course_id: newCourse.id,
            week_no: m.week_no,
            title: m.title,
            summary: m.summary || '',
            position: m.position ?? 0,
          })
          .select('id')
          .single()
      );
      moduleMap.set(m.id, inserted.id);
    }

    for (const mat of materials) {
      let nextStoragePath = mat.storage_path || null;
      if (nextStoragePath && !String(nextStoragePath).startsWith('r2:')) {
        const parts = String(nextStoragePath).split('/');
        const filename = parts.slice(1).join('/') || parts[0];
        const targetPath = `${newCourse.id}/${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${filename}`;
        try {
          const { error: copyErr } = await supabase.storage.from('materials').copy(nextStoragePath, targetPath);
          if (!copyErr) nextStoragePath = targetPath;
        } catch {
          // Keep existing path if storage copy fails
        }
      }
      await run(
        supabase.from('materials').insert({
          course_id: newCourse.id,
          module_id: mat.module_id ? moduleMap.get(mat.module_id) || null : null,
          kind: mat.kind,
          title: mat.title,
          url: mat.url || null,
          storage_path: nextStoragePath,
          size_bytes: mat.size_bytes ?? null,
          position: mat.position ?? 0,
        })
      );
    }
  }

  // 3. Clone quizzes (as unpublished drafts with cleared dates) and all questions
  const quizMap = new Map();
  if (includeQuizzes) {
    const quizzes = await run(
      supabase.from('quizzes').select('*').eq('course_id', sourceCourse.id).order('created_at')
    );
    const quizIds = quizzes.map((q) => q.id);
    const allQuestions = quizIds.length
      ? await run(
          supabase
            .from('questions')
            .select(`id, quiz_id, ${QUESTION_FIELDS.join(', ')}`)
            .in('quiz_id', quizIds)
            .order('position')
            .order('created_at')
        )
      : [];

    for (const qz of quizzes) {
      const insertedQuiz = await run(
        supabase
          .from('quizzes')
          .insert({
            course_id: newCourse.id,
            title: qz.title,
            instructions: qz.instructions || '',
            reference: qz.reference || '',
            opens_at: null,
            closes_at: null,
            duration_minutes: qz.duration_minutes ?? 30,
            max_attempts: qz.max_attempts ?? 1,
            is_practice: Boolean(qz.is_practice),
            shuffle_questions: qz.shuffle_questions ?? true,
            shuffle_options: qz.shuffle_options ?? true,
            published: false,
            results_released: false,
            show_answers: Boolean(qz.show_answers),
          })
          .select('id')
          .single()
      );
      quizMap.set(qz.id, insertedQuiz.id);

      const qRows = allQuestions
        .filter((x) => x.quiz_id === qz.id)
        .map((x) => {
          const row = { quiz_id: insertedQuiz.id };
          for (const k of QUESTION_FIELDS) row[k] = x[k];
          return row;
        });

      for (let i = 0; i < qRows.length; i += 100) {
        await run(supabase.from('questions').insert(qRows.slice(i, i + 100)));
      }
    }
  }

  // 4. Clone assignments (as unpublished drafts with cleared due date)
  const assignMap = new Map();
  if (includeAssignments) {
    const assignments = await run(
      supabase.from('assignments').select('*').eq('course_id', sourceCourse.id).order('created_at')
    );
    for (const asg of assignments) {
      const insertedAsg = await run(
        supabase
          .from('assignments')
          .insert({
            course_id: newCourse.id,
            title: asg.title,
            instructions: asg.instructions || '',
            due_at: null,
            max_marks: asg.max_marks ?? 100,
            allow_late: Boolean(asg.allow_late),
            published: false,
            results_released: false,
          })
          .select('id')
          .single()
      );
      assignMap.set(asg.id, insertedAsg.id);
    }
  }

  // 5. Clone CA component structure and remap item_ids + ca1/ca2 metadata IDs
  if (includeCA) {
    const comps = await run(
      supabase.from('ca_components').select('*').eq('course_id', sourceCourse.id).order('position').order('created_at')
    );
    const compMap = new Map();
    for (const c of comps) {
      let nextItems = [];
      if (Array.isArray(c.item_ids) && c.item_ids.length) {
        if (c.kind === 'quizzes') nextItems = c.item_ids.map((id) => quizMap.get(id)).filter(Boolean);
        else if (c.kind === 'assignments') nextItems = c.item_ids.map((id) => assignMap.get(id)).filter(Boolean);
      }
      const insertedComp = await run(
        supabase
          .from('ca_components')
          .insert({
            course_id: newCourse.id,
            name: c.name,
            kind: c.kind,
            weight: c.weight ?? 0,
            item_ids: nextItems,
            drop_lowest: c.drop_lowest ?? 0,
            max_score: c.max_score ?? 100,
            position: c.position ?? 0,
          })
          .select('id')
          .single()
      );
      compMap.set(c.id, insertedComp.id);
    }

    if (compMap.size > 0) {
      const nextCa1 = (meta.ca_config?.ca1_components || []).map((id) => compMap.get(id)).filter(Boolean);
      const nextCa2 = (meta.ca_config?.ca2_components || []).map((id) => compMap.get(id)).filter(Boolean);
      const updatedDesc = serializeCourseMeta(
        meta.about || '',
        { ...meta.ca_config, ca1_components: nextCa1, ca2_components: nextCa2 },
        { released: false, scores: {} }
      );
      await run(supabase.from('courses').update({ description: updatedDesc }).eq('id', newCourse.id));
    }
  }

  return newCourse;
}
