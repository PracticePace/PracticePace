// Privacy Policy — /privacy
//
// Written to what the app actually does rather than to a template: Supabase
// for auth and data, Vercel for hosting, Stripe for payments (no card data on
// our side), Supabase's own mailer for the three transactional emails, and
// browser localStorage for a handful of per-device conveniences.
//
// NOT REVIEWED BY A LAWYER. Same caveat as TermsPage.jsx — accurate to the
// product and reachable, which is what Stripe's live review and a school's
// procurement check both look for, but it should be read by counsel.

import { Link } from 'react-router-dom'
import LegalLayout, { LastUpdated, Section, P, List, LI } from '../components/marketing/LegalLayout'

const SUPPORT_EMAIL = 'practicepace@gmail.com'
const LAST_UPDATED  = 'October 9, 2026'

export default function PrivacyPage() {
  return (
    <LegalLayout
      eyebrow="Legal"
      title="Privacy Policy"
      intro={<LastUpdated date={LAST_UPDATED} />}
    >
      <P>
        This policy explains what Practice:Pace collects, why, who we share it
        with, and what you can ask us to do about it. It applies to the
        Practice:Pace website and application (&ldquo;the Service&rdquo;),
        operated by Practice:Pace (&ldquo;we&rdquo;, &ldquo;us&rdquo;).
      </P>

      <Section n="1" title="What we collect">
        <P>
          <strong>Account information.</strong> Your email address, your name
          if you provide it, your role (athletic director, head coach,
          assistant coach, team manager), and the program or school you belong
          to. Passwords are stored only as salted hashes by our authentication
          provider; we never see them in readable form.
        </P>
        <P>
          <strong>Content you enter.</strong> Practice scripts, drills and their
          durations, playlists and uploaded audio, videos, whiteboard images,
          team names and colors, scoreboard state, and any information you
          choose to record about coaches and athletes. We do not require athlete
          information for the Service to work.
        </P>
        <P>
          <strong>Billing information.</strong> A Stripe customer identifier, a
          subscription identifier, your plan, your subscription status, and
          trial dates. We do <strong>not</strong> collect or store card numbers
          — see Section 3.
        </P>
        <P>
          <strong>Technical information.</strong> Our hosting and
          infrastructure providers log standard request information such as IP
          address, timestamp, and user agent, which is used for security and
          troubleshooting.
        </P>
        <P>
          We do not use advertising trackers, we do not sell personal
          information, and we do not run third-party analytics or advertising
          pixels on the Service.
        </P>
      </Section>

      <Section n="2" title="Why we use it">
        <List>
          <LI>to create and secure your account and sign you in</LI>
          <LI>to store and display the practices, scripts and media you create</LI>
          <LI>to take payment and manage your subscription</LI>
          <LI>to send the transactional emails described in Section 4</LI>
          <LI>to answer support requests you send us</LI>
          <LI>to keep the Service working, diagnose faults, and prevent abuse</LI>
        </List>
        <P>
          We do not use your content to train machine-learning models, and we do
          not use it for marketing to anyone other than you.
        </P>
      </Section>

      <Section n="3" title="Payments">
        <P>
          Payments are processed by Stripe, Inc. Card details are entered on
          Stripe&rsquo;s own hosted checkout and billing portal and are sent
          directly to Stripe — they never pass through our servers, and we have
          no access to your card number, expiry, or security code. Stripe
          processes that information under its own privacy policy as a payment
          processor.
        </P>
      </Section>

      <Section n="4" title="Email we send">
        <P>
          The Service sends three kinds of transactional email, all through our
          authentication provider&rsquo;s mail service: a confirmation email
          when you sign up, a password-reset email when you request one, and an
          invitation email when a coach is invited to a program. We do not send
          marketing email to coaches without asking first, and the newsletter
          signup on our website is separate and optional.
        </P>
      </Section>

      <Section n="5" title="Hosting and service providers">
        <P>
          We do not sell or rent personal information. We share it only with the
          providers we need to run the Service, each of which processes it on
          our behalf:
        </P>
        <List>
          <LI>
            <strong>Supabase</strong> — authentication, the application
            database, file storage, and transactional email. This is where your
            account and all of your content is stored.
          </LI>
          <LI>
            <strong>Vercel</strong> — application hosting and the serverless
            endpoints the app calls. Vercel sees request metadata and server
            logs.
          </LI>
          <LI>
            <strong>Stripe</strong> — payment processing and the billing portal.
          </LI>
        </List>
        <P>
          We may also disclose information if we are required to by law, or
          where necessary to investigate a security incident or to protect our
          rights. If the Service is ever transferred to another owner, your
          information may transfer with it, and we will tell you before that
          happens.
        </P>
        <P>
          Our providers operate infrastructure in the United States, so your
          information is stored and processed there.
        </P>
      </Section>

      <Section n="6" title="Student and athlete data">
        <P>
          Practice:Pace is not designed to be a student information system, and
          athlete information is never required to use it. Where you do enter
          information about students, <strong>your school is the controller of
          that data and is responsible for it</strong> — for having the
          authority and any consent required to enter it, for complying with the
          laws and policies that apply to student records in your jurisdiction
          (in the United States this may include FERPA and state
          student-privacy laws), and for deciding which coaches may see it. We
          process it only on your instructions and only to provide the Service.
        </P>
        <P>
          Accounts are for coaches and staff. Children under 13 are not
          permitted to create accounts, and we do not knowingly collect personal
          information directly from them. If you believe we have, email us and
          we will delete it.
        </P>
      </Section>

      <Section n="7" title="Who can see your data inside the Service">
        <P>
          Access is scoped to your program and account. Coaches see the programs
          they have been added to; an athletic director sees the programs on
          their school&rsquo;s account. These boundaries are enforced in the
          database itself, not only in the interface. Removing a coach removes
          their access.
        </P>
        <P>
          A small number of our staff can access production data when it is
          necessary to operate the Service or to resolve a support request you
          have raised.
        </P>
      </Section>

      <Section n="8" title="Your browser">
        <P>
          The Service stores a few things in your browser on the device you are
          using: your login session, and small conveniences such as the state of
          a running scoreboard so it survives a reload. These are not
          advertising cookies, they are not shared with anyone, and they stay on
          that device.
        </P>
      </Section>

      <Section n="9" title="How long we keep it">
        <P>
          We keep your account and content for as long as your account exists.
          If you delete your account we remove it within 30 days, except for
          records we are required to keep — for example billing and tax records,
          and webhook logs needed to reconcile payments.
        </P>
      </Section>

      <Section n="10" title="Security">
        <P>
          Traffic to the Service is encrypted in transit. Access to data is
          enforced at the database level by row-level security policies, and
          billing fields can only be written by our payment webhook, not by any
          user. No system is perfectly secure, but we take the protection of
          your data seriously and will notify affected users if we become aware
          of a breach involving their personal information.
        </P>
      </Section>

      <Section n="11" title="Your rights">
        <P>
          You can ask us to show you the personal information we hold about you,
          correct it, export it, or delete it. Email{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="underline" style={{ color: '#ffffff' }}>
            {SUPPORT_EMAIL}
          </a>{' '}
          from the address on your account and we will respond within 30 days.
          Depending on where you live you may have additional rights under local
          law; tell us what you need and we will honour what applies to you.
          Account deletion is covered in our{' '}
          <Link to="/terms" className="underline" style={{ color: '#ffffff' }}>
            Terms of Service
          </Link>.
        </P>
      </Section>

      <Section n="12" title="Changes to this policy">
        <P>
          If we change this policy we will update the &ldquo;Last updated&rdquo;
          date at the top of this page, and for material changes we will give
          notice in the app or by email.
        </P>
      </Section>

      <Section n="13" title="Contact">
        <P>
          Questions, requests, or concerns about privacy? Email{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="underline" style={{ color: '#ffffff' }}>
            {SUPPORT_EMAIL}
          </a>.
        </P>
      </Section>
    </LegalLayout>
  )
}
