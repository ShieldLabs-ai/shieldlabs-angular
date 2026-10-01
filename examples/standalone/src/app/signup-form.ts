import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { injectIdentify } from '@shieldlabs-ai/angular';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-signup-form',
  imports: [ReactiveFormsModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="submit()">
      <label>
        Email
        <input type="email" formControlName="email" autocomplete="email" />
      </label>
      <label>
        Password
        <input type="password" formControlName="password" autocomplete="new-password" />
      </label>
      <button type="submit" [disabled]="form.invalid || submitting()">
        {{ submitting() ? 'Creating your account' : 'Create account' }}
      </button>
    </form>
    @if (message(); as text) {
      <p role="status">{{ text }}</p>
    }
  `,
})
export class SignupForm {
  private readonly http = inject(HttpClient);
  // One identification per signup: identify() runs when the form is submitted, never on render.
  private readonly identification = injectIdentify();

  protected readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });
  protected readonly submitting = signal(false);
  protected readonly message = signal('');

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.submitting()) return;
    this.submitting.set(true);
    this.message.set('');

    // null when there is no identification (for example a content blocker): send the signup anyway.
    // Your server treats a missing requestId as unverified, never as clean.
    const result = await this.identification.identify();

    try {
      // Your backend reads the verdict for requestId with a ShieldLabs server SDK.
      await firstValueFrom(this.http.post('/api/signup', { ...this.form.getRawValue(), requestId: result?.requestId ?? null }));
      this.message.set('Account created.');
    } catch {
      this.message.set('The signup did not go through. Please try again.');
    } finally {
      this.submitting.set(false);
    }
  }
}
