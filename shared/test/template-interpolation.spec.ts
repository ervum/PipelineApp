import { interpolateTemplate, resolveVar } from '../src';

describe('template-interpolation', () => {
  it('preserves numeric types when a string is a whole {{var}} token', () => {
    const res = interpolateTemplate(
      { steps: '{{steps}}', seed: '{{ seed }}', cfg: '{{cfg_scale}}' },
      { steps: 28, seed: 123456, cfg_scale: 3.5 },
    );
    expect(res.value).toEqual({ steps: 28, seed: 123456, cfg: 3.5 });
    expect(res.missing).toEqual([]);
    expect(res.used.sort()).toEqual(['cfg_scale', 'seed', 'steps']);
  });

  it('preserves boolean and nested object types for whole-token replacements', () => {
    const res = interpolateTemplate(
      { loop: '{{loop}}', extra: '{{meta}}' },
      { loop: true, meta: { a: 1, b: 'two' } },
    );
    expect(res.value).toEqual({ loop: true, extra: { a: 1, b: 'two' } });
    expect(res.missing).toEqual([]);
  });

  it('performs inline string concatenation when {{var}} is embedded in text', () => {
    const res = interpolateTemplate(
      { filename_prefix: 'forge_{{job_id}}_{{seed}}' },
      { job_id: 'job123', seed: 42 },
    );
    expect(res.value).toEqual({ filename_prefix: 'forge_job123_42' });
    expect(res.missing).toEqual([]);
    expect(res.used).toEqual(['job_id', 'seed']);
  });

  it('resolves nested dot-paths such as {{params.steps}} and {{params.nested.key}}', () => {
    const vars = {
      params: { steps: 30, sampler: 'euler', nested: { key: 'val' } },
    };
    expect(resolveVar(vars, 'params.steps')).toBe(30);
    expect(resolveVar(vars, 'params.nested.key')).toBe('val');

    const res = interpolateTemplate(
      {
        steps: '{{params.steps}}',
        desc: 'Sampler={{params.sampler}} ({{params.nested.key}})',
      },
      vars,
    );
    expect(res.value).toEqual({
      steps: 30,
      desc: 'Sampler=euler (val)',
    });
    expect(res.missing).toEqual([]);
  });

  it('traverses deeply nested objects and arrays', () => {
    const template = {
      input: {
        workflow: {
          '6': {
            inputs: {
              text: '{{enhanced_prompt}}',
              clip: ['30', '{{clip_idx}}'],
            },
          },
        },
      },
    };
    const res = interpolateTemplate(template, {
      enhanced_prompt: 'celestial katana',
      clip_idx: 1,
    });
    expect(res.value).toEqual({
      input: {
        workflow: {
          '6': {
            inputs: {
              text: 'celestial katana',
              clip: ['30', 1],
            },
          },
        },
      },
    });
  });

  it('reports missing variables and substitutes null for whole tokens or empty string inline', () => {
    const res = interpolateTemplate(
      {
        wholeMissing: '{{missing_num}}',
        inlineMissing: 'prefix_{{missing_str}}_suffix',
        present: '{{ok}}',
      },
      { ok: 'yes' },
    );
    expect(res.value).toEqual({
      wholeMissing: null,
      inlineMissing: 'prefix__suffix',
      present: 'yes',
    });
    expect(res.missing).toEqual(['missing_num', 'missing_str']);
    expect(res.used).toEqual(['missing_num', 'missing_str', 'ok']);
  });

  it('leaves non-string primitives untouched', () => {
    const res = interpolateTemplate(
      { count: 5, flag: false, nothing: null },
      {},
    );
    expect(res.value).toEqual({ count: 5, flag: false, nothing: null });
    expect(res.missing).toEqual([]);
    expect(res.used).toEqual([]);
  });
});
