// Terms of Service — /terms
//
// A standard SaaS terms draft covering what Practice:Pace actually does:
// annual subscriptions with auto-renewal, cancellation through the Stripe
// billing portal, no prorated refunds, Stripe as the payment processor,
// Supabase as the hosting provider, user-entered coach and athlete data, the
// school's responsibility for any student data, no accounts for children under
// 13, and deletion on request.
//
// NOT REVIEWED BY A LAWYER. This is a working draft written to the operating
// facts of the product so the pages exist, are accurate, and are reachable —
// Stripe's live-account review looks for exactly that. It is not legal advice
// and should be read by counsel before it carries real weight.

import { Link } from 'react-router-dom'
import LegalLayout, { LastUpdated, Section, P, List, LI } from '../components/marketing/LegalLayout'

const SUPPORT_EMAIL = 'practicepace@gmail.com'
const LAST_UPDATED  = 'October 9, 2026'

export default function TermsPage() {
  return (
    <LegalLayout
      eyebrow="Legal"
      title="Terms of Service"
      intro={<LastUpdated date={LAST_UPDATED} />}
    >
      <P>
        These Terms of Service (&ldquo;Terms&rdquo;) govern your use of
        Practice:Pace, a practice-management application for coaches
        (&ldquo;the Service&rdquo;). The Service is operated by Practice:Pace
        (&ldquo;we&rdquo;, &ldquo;us&rdquo;). By creating an account or using
        the Service, you agree to these Terms. If you do not agree, do not use
        the Service.
      </P>

      <Section n="1" title="Who may use the Service">
        <P>
          You must be at least 13 years old to create an account. Children
          under 13 are not permitted to create accounts or to use the Service,
          and we do not knowingly collect personal information from them. If
          you believe a child under 13 has created an account, contact us at{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="underline" style={{ color: '#ffffff' }}>
            {SUPPORT_EMAIL}
          </a>{' '}
          and we will remove it.
        </P>
        <P>
          If you create an account on behalf of a school, district, or other
          organization, you confirm you are authorized to accept these Terms on
          its behalf, and &ldquo;you&rdquo; includes that organization.
        </P>
      </Section>

      <Section n="2" title="Accounts and coaches">
        <P>
          You are responsible for the activity on your account, for keeping
          your password confidential, and for the coaches you invite to it. An
          athletic director or head coach who invites other coaches is
          responsible for who has access to their programs and for removing
          access when a coach leaves.
        </P>
      </Section>

      <Section n="3" title="Plans, billing and auto-renewal">
        <P>
          Practice:Pace is offered on two annual plans: Individual
          ($699 per year, one program) and School-Wide ($1,199 per year, every
          program in your school). New subscriptions begin with a 14-day free
          trial.
        </P>
        <List>
          <LI>
            <strong>Annual term.</strong> Subscriptions are billed annually in
            advance for a twelve-month term.
          </LI>
          <LI>
            <strong>Automatic renewal.</strong> Your subscription renews
            automatically at the end of each term, and the then-current annual
            price is charged to your payment method on file, unless you cancel
            before the renewal date.
          </LI>
          <LI>
            <strong>Cancellation.</strong> You may cancel at any time from the
            billing portal, reachable in the app under Settings &rarr;
            Subscription &amp; Billing &rarr; Manage Billing. Cancellation
            stops the next renewal; your access continues until the end of the
            term you have already paid for.
          </LI>
          <LI>
            <strong>No prorated refunds.</strong> We do not provide refunds or
            credits for partial terms, for periods in which you did not use the
            Service, or for programs or coaches removed mid-term.
          </LI>
          <LI>
            <strong>Price changes.</strong> We may change our prices. A change
            takes effect on your next renewal, and we will tell you before it
            does.
          </LI>
          <LI>
            <strong>Failed payments.</strong> If a renewal payment fails we may
            suspend your access to parts of the Service until payment succeeds.
          </LI>
        </List>
      </Section>

      <Section n="4" title="Payments and card data">
        <P>
          Payments are processed by Stripe, Inc. We do not collect, see, or
          store your card number, expiry, or security code — those go directly
          to Stripe, and your use of checkout and the billing portal is also
          subject to Stripe&rsquo;s own terms. We store only what we need to
          recognize your subscription: a Stripe customer and subscription
          identifier, your plan, and your subscription status.
        </P>
      </Section>

      <Section n="5" title="Plan limits">
        <P>
          The Individual plan covers one program. The School-Wide plan covers
          an unlimited number of programs within a single school. Adding
          programs beyond what your plan includes requires an upgrade, which
          you can make at any time. Both plans allow an unlimited number of
          coaches on the programs they cover.
        </P>
      </Section>

      <Section n="6" title="Your content">
        <P>
          You keep ownership of everything you put into the Service: practice
          scripts, drills, playlists, videos, whiteboard images, team and
          roster information, and anything else you enter or upload
          (&ldquo;Your Content&rdquo;). You grant us only the permission we need
          to host, store, back up, and display Your Content in order to operate
          the Service for you.
        </P>
        <P>
          You are responsible for having the right to upload Your Content. Do
          not upload material you do not have permission to use, and do not use
          the Service to store anything unlawful.
        </P>
      </Section>

      <Section n="7" title="Coach and athlete information">
        <P>
          Practice:Pace stores whatever information you choose to enter about
          coaches and athletes. We do not require athlete information in order
          for the Service to work, and we ask you not to enter more than your
          program genuinely needs.
        </P>
        <P>
          <strong>
            If you enter information about students, your school is responsible
            for that data.
          </strong>{' '}
          That includes having the authority and any consent required to enter
          it, complying with the laws and policies that apply to student
          records in your jurisdiction — in the United States this may include
          FERPA and state student-privacy laws — and deciding which coaches may
          see it. We act as a processor of that information on your
          instructions; we do not independently determine what student data is
          collected or why.
        </P>
      </Section>

      <Section n="8" title="Hosting and third-party services">
        <P>
          The Service runs on third-party infrastructure. Application data and
          authentication are hosted with Supabase, the application itself is
          served from Vercel, and payments are handled by Stripe. Using the
          Service means your data is stored and processed by these providers on
          our behalf. See our{' '}
          <Link to="/privacy" className="underline" style={{ color: '#ffffff' }}>
            Privacy Policy
          </Link>{' '}
          for more detail.
        </P>
      </Section>

      <Section n="9" title="Acceptable use">
        <P>You agree not to:</P>
        <List>
          <LI>share your login with people outside your program, or resell access to the Service</LI>
          <LI>attempt to access another account, program, or school&rsquo;s data</LI>
          <LI>probe, scan, or interfere with the Service or the infrastructure it runs on</LI>
          <LI>use the Service to store or distribute unlawful material</LI>
          <LI>copy, reverse engineer, or create a competing product from the Service</LI>
        </List>
      </Section>

      <Section n="10" title="Account deletion">
        <P>
          You can ask us to delete your account and its data at any time by
          emailing{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="underline" style={{ color: '#ffffff' }}>
            {SUPPORT_EMAIL}
          </a>{' '}
          from the address on the account. We will delete it within 30 days of
          confirming the request. Deletion is permanent and we cannot recover
          deleted content, so export anything you want to keep first. Deleting
          your account does not entitle you to a refund for the remainder of a
          paid term, and we may retain records we are required to keep, such as
          billing records.
        </P>
      </Section>

      <Section n="11" title="Service availability and changes">
        <P>
          We work to keep the Service available but do not guarantee
          uninterrupted access. We may add, change, or remove features, and we
          may perform maintenance that makes the Service temporarily
          unavailable. If we discontinue the Service entirely, we will give
          reasonable notice and a way to export your data.
        </P>
      </Section>

      <Section n="12" title="Suspension and termination">
        <P>
          We may suspend or terminate your account if you breach these Terms,
          if your payment fails and remains unpaid, or if we are required to by
          law. You may stop using the Service at any time; cancellation and
          refund terms are in Section 3.
        </P>
      </Section>

      <Section n="13" title="Disclaimers">
        <P>
          The Service is provided &ldquo;as is&rdquo; and &ldquo;as
          available&rdquo;, without warranties of any kind, whether express or
          implied, including any implied warranties of merchantability, fitness
          for a particular purpose, and non-infringement. We do not warrant
          that the Service will be error-free or that practice timers, clocks,
          or scoreboards will be accurate in all conditions. Do not rely on the
          Service as the official clock or score for a competition.
        </P>
      </Section>

      <Section n="14" title="Limitation of liability">
        <P>
          To the fullest extent permitted by law, we are not liable for
          indirect, incidental, special, consequential, or punitive damages, or
          for lost profits, lost data, or lost opportunities, arising out of
          your use of the Service. Our total liability for any claim relating to
          the Service is limited to the amount you paid us in the twelve months
          before the claim arose.
        </P>
      </Section>

      <Section n="15" title="Indemnity">
        <P>
          You agree to indemnify and hold us harmless from claims, damages, and
          costs arising out of Your Content, your use of the Service, or your
          breach of these Terms — including any claim relating to coach or
          athlete information you entered.
        </P>
      </Section>

      <Section n="16" title="Governing law">
        <P>
          These Terms are governed by the laws of the State of Alabama, United
          States, without regard to its conflict-of-laws rules. You and we agree
          to the exclusive jurisdiction of the state and federal courts located
          in Alabama for any dispute arising out of these Terms or the Service.
        </P>
      </Section>

      <Section n="17" title="Changes to these Terms">
        <P>
          We may update these Terms. When we do, we will change the &ldquo;Last
          updated&rdquo; date at the top of this page, and for material changes
          we will give notice in the app or by email. Continuing to use the
          Service after a change takes effect means you accept the updated
          Terms.
        </P>
      </Section>

      <Section n="18" title="Contact">
        <P>
          Questions about these Terms? Email{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="underline" style={{ color: '#ffffff' }}>
            {SUPPORT_EMAIL}
          </a>.
        </P>
      </Section>
    </LegalLayout>
  )
}
