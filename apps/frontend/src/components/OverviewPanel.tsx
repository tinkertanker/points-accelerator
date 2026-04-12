import type { BootstrapPayload, Settings } from "../types";

type OverviewPanelProps = {
  bootstrap: BootstrapPayload;
  settingsDraft: Settings;
};

export default function OverviewPanel({ bootstrap, settingsDraft }: OverviewPanelProps) {
  return (
    <div className="panel-stack">
      <dl className="stats-row stats-row--compact">
        <div className="stat-item">
          <dt>Groups</dt>
          <dd>{bootstrap.groups.length}</dd>
        </div>
        <div className="stat-item">
          <dt>Participants</dt>
          <dd>{bootstrap.participants.length}</dd>
        </div>
        <div className="stat-item">
          <dt>Assignments</dt>
          <dd>{bootstrap.assignments.length}</dd>
        </div>
        <div className="stat-item">
          <dt>Submissions</dt>
          <dd>{bootstrap.submissions.length}</dd>
        </div>
        <div className="stat-item">
          <dt>Shop Items</dt>
          <dd>{bootstrap.shopItems.length}</dd>
        </div>
      </dl>

      <section className="section walkthrough-section">
        <header className="section-header">
          <h2>Class launch checklist</h2>
        </header>
        <ol className="walkthrough">
          <li>
            <h3>Give staff roles their powers</h3>
            <p>
              In <strong>Economy shape</strong>, choose which Discord roles count as mentors. In{" "}
              <strong>Capability matrix</strong>, add your admin and economy roles, then turn on the powers each role
              should have. Leave <strong>max award</strong> blank for no cap, or set a number if you want a hard limit
              per command.
            </p>
          </li>
          <li>
            <h3>Map every student team to a Discord role</h3>
            <p>
              In <strong>Role mapping</strong>, create one group per student role. Students can only use{" "}
              <code>/balance</code> when their Discord role maps to exactly one active group.
            </p>
          </li>
          <li>
            <h3>Name the economy once</h3>
            <p>
              In <strong>Economy shape</strong>, set the labels for <strong>{settingsDraft.pointsName}</strong> and{" "}
              <strong>{settingsDraft.currencyName}</strong>, plus any passive earning rules you want before class
              starts.
            </p>
          </li>
          <li>
            <h3>Smoke test the class commands in Discord</h3>
            <p>
              Staff should test award and deduct flows with a reason. Students should test their own balance, the
              shared leaderboard, and the paged ledger feed.
            </p>
          </li>
        </ol>
        <p className="walkthrough-commands">
          <code>/award targets:@gryffindor points:5 reason:"helped another group"</code>
          <code>/deduct targets:@gryffindor points:2 reason:"late submission"</code>
          <code>/balance</code>
          <code>/leaderboard</code>
          <code>/ledger</code>
          <code>/ledger page:2</code>
        </p>
      </section>
    </div>
  );
}
