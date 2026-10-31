import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { RunPodTemplateEditorComponent } from './runpod-template-editor.component';

describe('RunPodTemplateEditorComponent', () => {
  let fixture: ComponentFixture<RunPodTemplateEditorComponent>;
  let component: RunPodTemplateEditorComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RunPodTemplateEditorComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    fixture = TestBed.createComponent(RunPodTemplateEditorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('computes live client-side interpolation preview preserving types and reporting missing vars', () => {
    component.templateText.set(
      JSON.stringify({
        input: {
          prompt: '{{enhanced_prompt}}',
          seed: '{{seed}}',
          steps: '{{steps}}',
          category: '{{params.iconCategory}}',
          unknownField: '{{non_existent_var}}',
        },
      }),
    );
    fixture.detectChanges();

    const preview = component.preview();
    expect(preview).not.toBeNull();
    const val = preview!.value as { input: Record<string, unknown> };
    expect(typeof val.input['seed']).toBe('number');
    expect(val.input['seed']).toBe(1234);
    expect(val.input['steps']).toBe(28);
    expect(val.input['category']).toBe('ITEM');
    expect(preview!.used).toContain('enhanced_prompt');
    expect(preview!.used).toContain('params.iconCategory');
    expect(preview!.missing).toEqual(['non_existent_var']);
  });

  it('inserts {{variable}} at the caret position via insertVariable()', () => {
    component.templateText.set('{"prompt": ""}');
    fixture.detectChanges();

    const editor = component.templateEditor()!;
    const textarea = (fixture.nativeElement as HTMLElement).querySelector(
      'textarea',
    ) as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(12, 12); // inside the quotes of ""

    component.insertVariable('enhanced_prompt');
    fixture.detectChanges();

    expect(editor.value()).toBe('{"prompt": "{{enhanced_prompt}}"}');
  });
});
