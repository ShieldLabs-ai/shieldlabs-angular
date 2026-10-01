import { Component } from '@angular/core';
import { injectShieldLabs } from '@shieldlabs-ai/angular';

import { SignupForm } from './signup-form';

@Component({
  selector: 'app-root',
  imports: [SignupForm],
  template: `
    <main>
      <h1>Create your account</h1>
      <app-signup-form />
      <p class="status">
        ShieldLabs agent: {{ shieldlabs.status() }}
        @if (shieldlabs.error(); as error) {
          ({{ error.code }}: the form still works, your server treats the signup as unverified)
        }
      </p>
    </main>
  `,
})
export class App {
  protected readonly shieldlabs = injectShieldLabs();
}
