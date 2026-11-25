import { Bullet, CONTACT_EMAIL, LegalPage, P, Section } from '@/components/legal-page';

/** Public terms of service (linked from Google's sign-in consent screen). */
export default function TermsScreen() {
  return (
    <LegalPage title="Terms of Service" updated="25 November 2026">
      <Section heading="About bdgtr">
        <P>
          bdgtr is a personal, non-commercial household budgeting app, provided free of charge to the
          people its owner invites. By signing in, you agree to these terms.
        </P>
      </Section>

      <Section heading="Using the app">
        <Bullet>Keep your sign-in secure and use the app only for your own household&apos;s budgeting.</Bullet>
        <Bullet>
          Only invite people you trust: household members can see that household&apos;s budgets and
          spending.
        </Bullet>
        <Bullet>Don&apos;t try to access other households&apos; data or disrupt the service.</Bullet>
      </Section>

      <Section heading="No financial advice">
        <P>
          bdgtr helps you keep track of what you plan and spend. It does not give financial, tax or
          legal advice, and you are responsible for your own financial decisions.
        </P>
      </Section>

      <Section heading="Availability">
        <P>
          The app is provided &quot;as is&quot;, without guarantees that it will always be available,
          error-free or that data can never be lost. Keep your own records of anything important.
        </P>
      </Section>

      <Section heading="Ending access">
        <P>
          You can stop using bdgtr and ask for your account to be deleted at any time (see the
          Privacy Policy). Access may be removed if these terms are broken.
        </P>
      </Section>

      <Section heading="Contact">
        <P>Questions about these terms: {CONTACT_EMAIL}.</P>
      </Section>
    </LegalPage>
  );
}
