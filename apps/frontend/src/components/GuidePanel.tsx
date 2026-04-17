import { useRef } from "react";

const SECTIONS = [
  { id: "quick-start", label: "Quick start" },
  { id: "economy", label: "How the economy works" },
  { id: "commands", label: "Command reference" },
  { id: "dashboard", label: "Dashboard & roles" },
  { id: "shop", label: "Shop & purchases" },
  { id: "assignments", label: "Assignments & submissions" },
  { id: "faq", label: "FAQ" },
] as const;

function scrollToSection(id: string, containerRef: React.RefObject<HTMLDivElement | null>) {
  const container = containerRef.current;
  if (!container) return;

  const details = container.querySelector<HTMLDetailsElement>(`#guide-${id}`);
  if (!details) return;

  details.open = true;
  details.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function GuidePanel() {
  const contentRef = useRef<HTMLDivElement>(null);

  return (
    <div className="panel-stack">
      <div className="guide-layout">
        <nav className="guide-nav" aria-label="Guide sections">
          <ul>
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="guide-nav__link"
                  onClick={() => scrollToSection(s.id, contentRef)}
                >
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="guide-content" ref={contentRef}>
          {/* A — Quick Start Checklist */}
          <details id="guide-quick-start" className="guide-section" open>
            <summary>Quick start checklist</summary>
            <div className="guide-prose">
              <ol className="walkthrough">
                <li>
                  <h3>Give staff roles their powers</h3>
                  <p>
                    In <strong>Settings → Economy shape</strong>, choose which Discord roles count as mentors. In the{" "}
                    <strong>Capability matrix</strong>, add your admin and economy roles, then turn on the powers each
                    role should have. Leave <strong>max award</strong> blank for no cap, or set a number to impose a hard
                    limit per command.
                  </p>
                </li>
                <li>
                  <h3>Map every student team to a Discord role</h3>
                  <p>
                    In <strong>Groups → Role mapping</strong>, create one group per student role. Students can only use{" "}
                    <code>/balance</code> when their Discord role maps to exactly one active group, and their wallet is
                    created automatically the first time they interact with the bot.
                  </p>
                </li>
                <li>
                  <h3>Name the economy once</h3>
                  <p>
                    In <strong>Settings → Economy shape</strong>, set the labels for your points and currency, choose the
                    donation conversion rate, and configure any passive earning rules you want before class starts.
                  </p>
                </li>
                <li>
                  <h3>Smoke-test the class commands in Discord</h3>
                  <p>
                    Staff should test award and deduct flows with a reason. Students should test their own balance, the
                    shared leaderboard, wallet-to-wallet transfers, group-point donations, and the paged points ledger
                    feed.
                  </p>
                </li>
              </ol>
              <p className="walkthrough-commands">
                <code>/award targets:@gryffindor points:5 reason:&quot;helped another group&quot;</code>
                <code>/award member:@harry currency:3 reason:&quot;great explanation&quot;</code>
                <code>/deduct targets:@gryffindor points:2 reason:&quot;late submission&quot;</code>
                <code>/balance</code>
                <code>/transfer member:@harry amount:3</code>
                <code>/donate amount:2</code>
                <code>/buyforme item_id:bubble-tea</code>
                <code>/buyforgroup item_id:pizza quantity:2</code>
                <code>/leaderboard</code>
                <code>/ledger</code>
                <code>/ledger page:2</code>
              </p>
            </div>
          </details>

          {/* B — How the Economy Works */}
          <details id="guide-economy" className="guide-section">
            <summary>How the economy works</summary>
            <div className="guide-prose">
              <h3>Two-tier currency</h3>
              <p>
                The economy has two layers. <strong>Group points</strong> are a shared pool belonging to the whole team —
                they drive the leaderboard and are spent on group shop purchases.{" "}
                <strong>Personal wallet currency</strong> belongs to individual students and is used for personal
                purchases, transfers between students, and donations to the group pool.
              </p>

              <h3>Earning passively</h3>
              <p>
                When passive earning is enabled, the bot awards both group points and personal currency for qualifying
                chat messages. A message qualifies if it meets the minimum character count, is sent in an allowed channel,
                and enough time has passed since that student&rsquo;s last reward (the cooldown). Configure all of these
                in <strong>Settings → Passive rewards</strong>.
              </p>

              <h3>Earning actively</h3>
              <p>
                Staff use <code>/award</code> and <code>/deduct</code> to adjust group points. To adjust personal
                wallets, include the <code>member:</code> and <code>currency:</code> options. Approved assignment
                submissions also award both points and currency automatically.
              </p>

              <h3>The donation bridge</h3>
              <p>
                Students can convert personal currency into group points using <code>/donate</code>. The conversion rate
                is set in <strong>Settings → Economy shape</strong> (e.g. 1 currency = 10 points). This is a one-way
                conversion — points cannot be turned back into currency.
              </p>

              <h3>How balances flow</h3>
              <dl className="guide-flow">
                <dt><code>/award targets:@team points:5</code></dt>
                <dd>Adds 5 to the team&rsquo;s group points</dd>
                <dt><code>/award member:@alice currency:3</code></dt>
                <dd>Adds 3 to Alice&rsquo;s personal wallet</dd>
                <dt><code>/transfer member:@bob amount:2</code></dt>
                <dd>Moves 2 currency from your wallet to Bob&rsquo;s</dd>
                <dt><code>/donate amount:4</code></dt>
                <dd>Converts 4 of your currency into group points (at the configured rate)</dd>
              </dl>
            </div>
          </details>

          {/* C — Command Reference */}
          <details id="guide-commands" className="guide-section">
            <summary>Command reference</summary>
            <div className="guide-prose">
              <div className="matrix-scroll">
                <table className="matrix-table guide-command-table">
                  <thead>
                    <tr>
                      <th>Command</th>
                      <th>Who</th>
                      <th>Parameters</th>
                      <th>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td colSpan={4} className="guide-group-heading">Staff commands</td>
                    </tr>
                    <tr>
                      <td><code>/award</code></td>
                      <td>Staff</td>
                      <td><code>targets</code> <code>points</code> <code>member</code> <code>currency</code> <code>reason</code></td>
                      <td>Award group points and/or personal currency</td>
                    </tr>
                    <tr>
                      <td><code>/deduct</code></td>
                      <td>Staff</td>
                      <td><code>targets</code> <code>points</code> <code>member</code> <code>currency</code> <code>reason</code></td>
                      <td>Deduct group points and/or personal currency</td>
                    </tr>
                    <tr>
                      <td><code>/sell</code></td>
                      <td>Staff</td>
                      <td><code>title</code> <code>description</code> <code>quantity</code></td>
                      <td>Create a marketplace listing for peer-to-peer trading</td>
                    </tr>
                    <tr>
                      <td><code>/submissions</code></td>
                      <td>Staff</td>
                      <td><code>assignment</code></td>
                      <td>View recent submissions for review</td>
                    </tr>
                    <tr>
                      <td><code>/review_submission</code></td>
                      <td>Staff</td>
                      <td><code>submission_id</code> <code>decision</code> <code>note</code></td>
                      <td>Approve, reject, or mark a submission as outstanding</td>
                    </tr>
                    <tr>
                      <td><code>/missing</code></td>
                      <td>Staff</td>
                      <td>&mdash;</td>
                      <td>List participants who haven&rsquo;t submitted for each active assignment</td>
                    </tr>

                    <tr>
                      <td colSpan={4} className="guide-group-heading">Student commands</td>
                    </tr>
                    <tr>
                      <td><code>/balance</code></td>
                      <td>Student</td>
                      <td>&mdash;</td>
                      <td>Show your group points and personal wallet balance</td>
                    </tr>
                    <tr>
                      <td><code>/transfer</code></td>
                      <td>Student</td>
                      <td><code>member</code> <code>amount</code></td>
                      <td>Send wallet currency to another student</td>
                    </tr>
                    <tr>
                      <td><code>/donate</code></td>
                      <td>Student</td>
                      <td><code>amount</code></td>
                      <td>Convert personal currency into group points</td>
                    </tr>
                    <tr>
                      <td><code>/submit</code></td>
                      <td>Student</td>
                      <td><code>assignment</code> <code>image</code> <code>text</code></td>
                      <td>Submit work for an assignment (image and/or text)</td>
                    </tr>

                    <tr>
                      <td colSpan={4} className="guide-group-heading">Everyone</td>
                    </tr>
                    <tr>
                      <td><code>/leaderboard</code></td>
                      <td>Everyone</td>
                      <td>&mdash;</td>
                      <td>Show the top 10 groups by points</td>
                    </tr>
                    <tr>
                      <td><code>/ledger</code></td>
                      <td>Everyone</td>
                      <td><code>page</code></td>
                      <td>Browse recent ledger entries (10 per page)</td>
                    </tr>
                    <tr>
                      <td><code>/store</code></td>
                      <td>Everyone</td>
                      <td>&mdash;</td>
                      <td>Browse all enabled shop items</td>
                    </tr>
                    <tr>
                      <td><code>/buyforme</code></td>
                      <td>Everyone</td>
                      <td><code>item_id</code> <code>quantity</code></td>
                      <td>Buy an item for yourself using personal currency</td>
                    </tr>
                    <tr>
                      <td><code>/buyforgroup</code></td>
                      <td>Everyone</td>
                      <td><code>item_id</code> <code>quantity</code></td>
                      <td>Request a group purchase using group points (needs approval)</td>
                    </tr>
                    <tr>
                      <td><code>/approve_purchase</code></td>
                      <td>Everyone</td>
                      <td><code>purchase_id</code></td>
                      <td>Approve a pending group purchase for your team</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p>
                Students can also submit by replying to their own message while mentioning the bot:{" "}
                <code>@bot submit assignment-name</code>. The bot picks up the text and any image from the original
                message.
              </p>
            </div>
          </details>

          {/* D — Dashboard & Roles */}
          <details id="guide-dashboard" className="guide-section">
            <summary>Dashboard &amp; roles</summary>
            <div className="guide-prose">
              <h3>Access levels</h3>
              <p>
                The dashboard adapts based on your role. <strong>Admins</strong> (guild owners and roles with the{" "}
                <em>canManageDashboard</em> capability) see every tab. <strong>Mentors</strong> (roles listed in
                Settings → Mentor roles) see Shop, Assignments, Leaderboard, and this Guide.{" "}
                <strong>Members</strong> see only the Leaderboard and this Guide.
              </p>

              <h3>Tab overview</h3>
              <dl className="guide-flow">
                <dt>Overview</dt>
                <dd>At-a-glance counts for groups, participants, assignments, submissions, and shop items.</dd>
                <dt>Settings</dt>
                <dd>Economy shape (names, conversion rate, passive rewards), mentor roles, log channels, and the capability matrix.</dd>
                <dt>Groups</dt>
                <dd>Map Discord roles to student teams. Set display names, aliases, and mentor names.</dd>
                <dt>Shop</dt>
                <dd>Create and manage items students can buy with points or currency.</dd>
                <dt>Assignments</dt>
                <dd>Create prompts with deadlines and rewards. Review student submissions.</dd>
                <dt>Activity</dt>
                <dd>Live leaderboard and the full transaction ledger.</dd>
              </dl>

              <h3>Capability matrix</h3>
              <p>
                Each Discord role can be given fine-grained permissions in <strong>Settings → Capability matrix</strong>:
              </p>
              <dl className="guide-flow">
                <dt>canAward / canDeduct</dt>
                <dd>Allow this role to use <code>/award</code> and <code>/deduct</code>.</dd>
                <dt>maxAward</dt>
                <dd>Cap the amount that can be awarded or deducted in a single command. Leave blank for no limit.</dd>
                <dt>canMultiAward</dt>
                <dd>Allow targeting multiple groups in one <code>/award</code> or <code>/deduct</code>.</dd>
                <dt>canSell</dt>
                <dd>Allow creating marketplace listings via <code>/sell</code>.</dd>
                <dt>canReceiveAwards</dt>
                <dd>Allow this role&rsquo;s group to be the target of awards. Disable to prevent self-awarding.</dd>
              </dl>
              <p>
                Permissions are combined across all of a user&rsquo;s roles — the most permissive setting wins.
              </p>
            </div>
          </details>

          {/* E — Shop & Purchases */}
          <details id="guide-shop" className="guide-section">
            <summary>Shop &amp; purchases</summary>
            <div className="guide-prose">
              <h3>Individual items</h3>
              <p>
                Items with the <strong>Individual</strong> audience cost personal wallet currency. Students buy them
                with <code>/buyforme</code> and the purchase is fulfilled immediately. Add fulfilment instructions
                (e.g. &ldquo;show this receipt to a mentor&rdquo;) to tell students what happens next.
              </p>

              <h3>Group items</h3>
              <p>
                Items with the <strong>Group</strong> audience cost group points. A student initiates the purchase
                with <code>/buyforgroup</code>, then other group members approve it with{" "}
                <code>/approve_purchase</code>. The number of approvals required scales with group size. Once the
                threshold is met, the points are deducted and the item is fulfilled.
              </p>

              <h3>Stock management</h3>
              <p>
                Leave stock blank for unlimited supply. Set a number to cap how many times the item can be purchased —
                stock is deducted on fulfilment.
              </p>

              <h3>Marketplace listings</h3>
              <p>
                Staff can create peer-to-peer listings with <code>/sell</code>. These are posted to the configured
                listing channel and allow students to trade items outside the standard shop.
              </p>
            </div>
          </details>

          {/* F — Assignments & Submissions */}
          <details id="guide-assignments" className="guide-section">
            <summary>Assignments &amp; submissions</summary>
            <div className="guide-prose">
              <h3>Creating assignments</h3>
              <p>
                In the <strong>Assignments</strong> tab, add a title, description, and reward amounts. Rewards are
                split into <strong>base</strong> (always given on approval) and <strong>bonus</strong> (given for
                outstanding work). Set a deadline to automatically reject late submissions, or leave it blank for
                open-ended assignments.
              </p>

              <h3>Submitting work</h3>
              <p>
                Students use <code>/submit assignment-name</code> with an optional image attachment and text
                description. They can also reply to their own Discord message while mentioning the bot — the bot
                picks up the text and image from the original message. Images up to 10 MB are supported.
              </p>

              <h3>Review workflow</h3>
              <dl className="guide-flow">
                <dt>Pending</dt>
                <dd>Newly submitted, awaiting staff review.</dd>
                <dt>Approved</dt>
                <dd>Base rewards (points + currency) are automatically credited to the student and their group.</dd>
                <dt>Outstanding</dt>
                <dd>Exceptional work — bonus rewards are credited on top of the base amount.</dd>
                <dt>Rejected</dt>
                <dd>No rewards. The student can resubmit if the assignment is still active.</dd>
              </dl>
              <p>
                Use <code>/missing</code> to see which participants haven&rsquo;t submitted for each active assignment.
              </p>
            </div>
          </details>

          {/* G — FAQ */}
          <details id="guide-faq" className="guide-section">
            <summary>Frequently asked questions</summary>
            <div className="guide-prose">
              <h3>How do students join the economy?</h3>
              <p>
                Students need exactly one Discord role that maps to an active group. Their wallet is created
                automatically the first time they interact with the bot (e.g. <code>/balance</code>).
              </p>

              <h3>What if a student has multiple group roles?</h3>
              <p>
                The bot requires a one-to-one mapping. If a student has more than one group role, commands like{" "}
                <code>/balance</code> will fail. Remove the extra role so they map to exactly one group.
              </p>

              <h3>What are aliases for?</h3>
              <p>
                Groups can have comma-separated aliases so staff can use shorthand in commands — for
                example, <code>/award targets:alpha points:5 reason:&quot;well done&quot;</code> instead of mentioning
                the full Discord role.
              </p>

              <h3>How does the passive-reward cooldown work?</h3>
              <p>
                The cooldown is tracked per student, per group, in the bot&rsquo;s memory. After a student earns a
                passive reward, they must wait the configured number of seconds before their next qualifying message
                earns again. The cooldown resets if the bot restarts.
              </p>

              <h3>Can I reset all balances?</h3>
              <p>
                There is no reset button in the dashboard. To reset balances you would need to clear the ledger data
                directly in the database. Reach out to the project maintainer if you need a full reset.
              </p>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
