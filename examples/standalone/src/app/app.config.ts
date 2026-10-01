import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideZonelessChangeDetection, type ApplicationConfig } from '@angular/core';
import { provideShieldLabs } from '@shieldlabs-ai/angular';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideHttpClient(withFetch()),
    // Loads the ShieldLabs agent once, after the first render in the browser.
    provideShieldLabs({ publicKey: SHIELDLABS_PUBLIC_KEY }),
  ],
};
