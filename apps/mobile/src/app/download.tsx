import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Link } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/app-text';
import { Bullet, LegalPage, P, Section } from '@/components/legal-page';
import { colors, MIN_TOUCH, radius, spacing } from '@/theme/tokens';

/**
 * The APK lives on GitHub Releases (the repo is public): Cloudflare Pages
 * can't serve files over 25 MB. "latest/download/bdgtr.apk" always points to
 * the newest release, so this page doesn't change per release. Each release
 * must upload the file as exactly "bdgtr.apk".
 */
export const APK_URL = 'https://github.com/erroldee1984/bdgtr/releases/latest/download/bdgtr.apk';
export const RELEASES_URL = 'https://github.com/erroldee1984/bdgtr/releases';
/**
 * Flip to true once the first GitHub release with bdgtr.apk is published.
 * Until then the button would lead to GitHub's "not found" page.
 */
export const APK_AVAILABLE = false;

/** bdgtr.erroldee.com/download (docs/PLAN.md §2a): the Android app and how to install it. Public, no sign-in. */
export default function DownloadScreen() {
  return (
    <LegalPage title="Get bdgtr for Android">
      <P>
        The bdgtr Android app isn&apos;t on Google Play. You install it straight from here. It&apos;s free, and it&apos;s the same app with
        the same account as this website.
      </P>

      {APK_AVAILABLE ? (
        <>
          <Link href={APK_URL} style={styles.button} accessibilityLabel="Download bdgtr.apk, the Android app">
            <View style={styles.buttonInner}>
              <MaterialCommunityIcons name="download" size={22} color={colors.onPrimary} aria-hidden />
              <AppText variant="bodyStrong" style={styles.buttonText}>
                Download bdgtr.apk
              </AppText>
            </View>
          </Link>
          <AppText variant="caption" tone="secondary">
            Needs Android 7.0 or newer. About 50–120 MB.{' '}
            <Link href={RELEASES_URL}>
              <AppText variant="caption" tone="accent">
                All versions and checksums
              </AppText>
            </Link>
          </AppText>
        </>
      ) : (
        <View style={styles.soon} role="status">
          <MaterialCommunityIcons name="progress-clock" size={22} color={colors.primaryLight} aria-hidden />
          <AppText style={styles.flex}>
            The first release is being prepared. Check back soon, or use bdgtr in your browser meanwhile.
          </AppText>
        </View>
      )}

      <Section heading="Install it">
        <Bullet marker="1.">Open this page on your Android phone and tap Download bdgtr.apk.</Bullet>
        <Bullet marker="2.">
          When the download finishes, tap the file (or open it from Downloads). Android asks you to allow your browser to install apps: tap
          Settings, turn on Allow from this source, then go back.
        </Bullet>
        <Bullet marker="3.">
          Tap Install. If Google Play Protect says the app isn&apos;t recognised, tap More details, then Install anyway.
        </Bullet>
        <Bullet marker="4.">Open bdgtr and sign in with the same Google account you use on the website.</Bullet>
        <P>
          You only allow installs from your browser once. You can turn it off again afterwards in Settings → Apps → your browser → Install
          unknown apps.
        </P>
      </Section>

      <Section heading="Updating">
        <P>
          Download the latest file from this page and install it over the old one. Your sign-in and settings stay. Spends you saved while
          offline stay too, but let them send before updating to be safe.
        </P>
      </Section>

      <Section heading="Turn on notifications">
        <P>In the app, go to More → Settings → Turn on notifications to get budget alerts and the 7 AM daily summary on your phone.</P>
      </Section>

      <Section heading="Is it safe?">
        <Bullet>The app only talks to bdgtr&apos;s own server and Google sign-in. It has no ads or tracking.</Bullet>
        <Bullet>Each release lists the file&apos;s SHA-256 checksum, so you can check the download is the real one.</Bullet>
        <Bullet>Android shows warnings for any app from outside Google Play. That&apos;s expected here.</Bullet>
      </Section>

      <Section heading="Rather not install anything?">
        <P>
          Use bdgtr in your phone&apos;s browser at bdgtr.erroldee.com. In Chrome, open the ⋮ menu and choose Add to home screen (or Install
          app) to get an icon like an app. Offline mode is only in the Android app.
        </P>
      </Section>
    </LegalPage>
  );
}

const styles = StyleSheet.create({
  button: { alignSelf: 'flex-start', borderRadius: radius.button, backgroundColor: colors.primary, marginTop: spacing.sm },
  buttonInner: { minHeight: MIN_TOUCH, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg },
  buttonText: { color: colors.onPrimary },
  soon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.card,
    backgroundColor: colors.surface,
  },
  flex: { flex: 1 },
});
