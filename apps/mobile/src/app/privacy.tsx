import { Bullet, CONTACT_EMAIL, LegalPage, P, Section } from '@/components/legal-page';

/** Public privacy policy (linked from Google's sign-in consent screen). */
export default function PrivacyScreen() {
  return (
    <LegalPage title="Privacy Policy" updated="25 November 2026">
      <Section heading="Who we are">
        <P>
          bdgtr is a personal, non-commercial household budgeting app for Android and the web
          (bdgtr.erroldee.com). It is run by its owner, who you can contact at {CONTACT_EMAIL}.
        </P>
      </Section>

      <Section heading="What we collect">
        <Bullet>
          Your account: when you sign in (for example with Google), our sign-in provider receives
          your name, email address and profile picture. Our database stores your email address and
          an account ID.
        </Bullet>
        <Bullet>
          What you enter: households, members and invitations, budgets, categories, fixed
          transactions and spending entries, including any optional descriptions you type.
        </Bullet>
        <Bullet>
          If you turn on notifications: a device token so we can send budget alerts and daily
          summaries to your phone or browser.
        </Bullet>
        <Bullet>
          Technical data that our hosting providers log automatically, such as IP addresses and
          request times, to keep the service running and secure.
        </Bullet>
        <P>
          We do not use advertising, analytics or tracking tools, and we never sell your data.
        </P>
      </Section>

      <Section heading="How we use it">
        <P>
          Only to run the app: to sign you in, to share a household&apos;s budget with the members
          of that household, to calculate budgets and remaining amounts, and to send the alerts and
          summaries you have chosen to receive.
        </P>
      </Section>

      <Section heading="Who can see it">
        <Bullet>
          Members of your household can see that household&apos;s budgets and transactions,
          including who entered each one. Pinned items are stored only on your own device.
        </Bullet>
        <Bullet>
          Service providers that host or operate parts of the app for us, under their own privacy
          and security terms: Clerk (sign-in), MongoDB Atlas (database), Vercel (server), Cloudflare
          (website and domain), Google (sign-in with Google) and Expo (app builds and push
          notifications).
        </Bullet>
        <P>
          Our database and server run in Singapore. Some providers may process data in other
          countries.
        </P>
      </Section>

      <Section heading="Keeping and deleting your data">
        <P>
          We keep your data while you use the app. You can ask us to delete your account at any time
          by emailing {CONTACT_EMAIL}. We then delete your account and personal details. Spending you
          entered in a shared household stays part of that household&apos;s records for its other
          members, unless the household itself is deleted.
        </P>
      </Section>

      <Section heading="Your rights">
        <P>
          You can ask to access, correct or delete your personal data, or ask questions about how it
          is handled, including under the Philippines&apos; Data Privacy Act of 2012. Email{' '}
          {CONTACT_EMAIL} and we will reply as soon as we can.
        </P>
      </Section>

      <Section heading="Security">
        <P>
          Data travels over encrypted connections (HTTPS). Every request is checked against your
          signed-in account and your household membership, and access to the database is limited to
          the app&apos;s server.
        </P>
      </Section>

      <Section heading="Children">
        <P>bdgtr is not intended for children under 13.</P>
      </Section>

      <Section heading="Changes">
        <P>
          If this policy changes, we will update this page and the date at the top.
        </P>
      </Section>
    </LegalPage>
  );
}
