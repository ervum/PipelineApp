import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { PromptDiffComponent } from './prompt-diff.component';

describe('PromptDiffComponent', () => {
  let fixture: ComponentFixture<PromptDiffComponent>;
  let component: PromptDiffComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PromptDiffComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    fixture = TestBed.createComponent(PromptDiffComponent);
    component = fixture.componentInstance;
  });

  it('computes word diff segments and renders <ins> and <del> in inline mode', () => {
    fixture.componentRef.setInput('before', 'A fire katana icon');
    fixture.componentRef.setInput(
      'after',
      'A legendary ember-forged katana icon, die-cut centered',
    );
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const insElements = Array.from(host.querySelectorAll('ins')).map(
      (el) => el.textContent,
    );
    const delElements = Array.from(host.querySelectorAll('del')).map(
      (el) => el.textContent,
    );

    expect(insElements.join(' ')).toContain('legendary');
    expect(delElements.join(' ')).toContain('fire');
    expect(component.stats().added).toBeGreaterThan(0);
    expect(component.stats().removed).toBeGreaterThan(0);
  });

  it('renders two columns in split mode', () => {
    fixture.componentRef.setInput('before', 'Old sword');
    fixture.componentRef.setInput('after', 'New obsidian sword');
    fixture.componentRef.setInput('mode', 'split');
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const splitCols = host.querySelectorAll('.split-col');
    expect(splitCols.length).toBe(2);
    expect(splitCols[0]?.querySelector('del')?.textContent).toContain('Old');
    expect(splitCols[1]?.querySelector('ins')?.textContent).toContain('New');
  });
});
