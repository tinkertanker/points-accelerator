import { useState } from "react";

import type { AssignmentDraft, BootstrapPayload, Submission } from "../types";
import { fromDateTimeLocalInputValue, toDateTimeLocalInputValue } from "../utils/datetime-local";

const STATUS_LABELS: Record<Submission["status"], string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  OUTSTANDING: "Outstanding",
  REJECTED: "Rejected",
};

const STATUS_CLASSES: Record<Submission["status"], string> = {
  PENDING: "badge--pending",
  APPROVED: "badge--approved",
  OUTSTANDING: "badge--outstanding",
  REJECTED: "badge--rejected",
};

const VIDEO_URL_PATTERN = /\.(mp4|m4v|mov|webm)(?:[?#].*)?$/i;

type ReviewStatus = Exclude<Submission["status"], "PENDING">;

type AssignmentsPanelProps = {
  bootstrap: BootstrapPayload;
  assignmentDrafts: AssignmentDraft[];
  isBusy: boolean;
  createAssignmentDraft: () => AssignmentDraft;
  onAssignmentDraftsChange: (next: AssignmentDraft[]) => void;
  onSaveAssignments: () => Promise<void>;
  onReviewSubmission: (submission: Submission, status: ReviewStatus) => Promise<boolean>;
};

export default function AssignmentsPanel({
  bootstrap,
  assignmentDrafts,
  isBusy,
  createAssignmentDraft,
  onAssignmentDraftsChange,
  onSaveAssignments,
  onReviewSubmission,
}: AssignmentsPanelProps) {
  const [submissionFilter, setSubmissionFilter] = useState<{ assignmentId: string; status: string }>({
    assignmentId: "",
    status: "",
  });
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const filteredSubmissions = bootstrap.submissions.filter((submission) => {
    if (submissionFilter.assignmentId && submission.assignmentId !== submissionFilter.assignmentId) {
      return false;
    }

    if (submissionFilter.status && submission.status !== submissionFilter.status) {
      return false;
    }

    return true;
  });

  const handleReview = async (submission: Submission, status: ReviewStatus) => {
    if (await onReviewSubmission(submission, status)) {
      setReviewingId(null);
    }
  };

  return (
    <div className="panel-stack">
      <article className="section">
        <header className="section-header">
          <h2>Create and edit assignment prompts</h2>
          <button
            className="primary-action"
            type="button"
            onClick={() => void onSaveAssignments()}
            disabled={isBusy}
          >
            Save Assignments
          </button>
        </header>
        <div className="matrix-scroll">
          <table className="matrix-table assignment-table">
            <thead>
              <tr>
                <th scope="col" className="col-title">
                  Title
                </th>
                <th scope="col" className="col-description">
                  Description
                </th>
                <th scope="col" className="col-pts">
                  Base Pts
                </th>
                <th scope="col" className="col-cur">
                  Base Cur
                </th>
                <th scope="col" className="col-pts">
                  Bonus Pts
                </th>
                <th scope="col" className="col-cur">
                  Bonus Cur
                </th>
                <th scope="col" className="col-deadline">
                  Deadline
                </th>
                <th scope="col" className="matrix-table__th--center col-active">
                  Active
                </th>
              </tr>
            </thead>
            <tbody>
              {assignmentDrafts.map((assignment, index) => (
                <tr key={`${assignment.id ?? "new"}-${index}`}>
                  <td className="col-title">
                    <input
                      value={assignment.title}
                      aria-label="Title"
                      onChange={(event) => {
                        const next = [...assignmentDrafts];
                        next[index] = { ...assignment, title: event.target.value };
                        onAssignmentDraftsChange(next);
                      }}
                      placeholder="Assignment title"
                    />
                  </td>
                  <td className="col-description">
                    <input
                      value={assignment.description}
                      aria-label="Description"
                      onChange={(event) => {
                        const next = [...assignmentDrafts];
                        next[index] = { ...assignment, description: event.target.value };
                        onAssignmentDraftsChange(next);
                      }}
                      placeholder="Instructions"
                    />
                  </td>
                  <td className="col-pts">
                    <input
                      type="number"
                      value={assignment.basePointsReward}
                      aria-label="Base points"
                      onChange={(event) => {
                        const next = [...assignmentDrafts];
                        next[index] = { ...assignment, basePointsReward: Number(event.target.value) };
                        onAssignmentDraftsChange(next);
                      }}
                    />
                  </td>
                  <td className="col-cur">
                    <input
                      type="number"
                      value={assignment.baseCurrencyReward}
                      aria-label="Base currency"
                      onChange={(event) => {
                        const next = [...assignmentDrafts];
                        next[index] = { ...assignment, baseCurrencyReward: Number(event.target.value) };
                        onAssignmentDraftsChange(next);
                      }}
                    />
                  </td>
                  <td className="col-pts">
                    <input
                      type="number"
                      value={assignment.bonusPointsReward}
                      aria-label="Bonus points"
                      onChange={(event) => {
                        const next = [...assignmentDrafts];
                        next[index] = { ...assignment, bonusPointsReward: Number(event.target.value) };
                        onAssignmentDraftsChange(next);
                      }}
                    />
                  </td>
                  <td className="col-cur">
                    <input
                      type="number"
                      value={assignment.bonusCurrencyReward}
                      aria-label="Bonus currency"
                      onChange={(event) => {
                        const next = [...assignmentDrafts];
                        next[index] = { ...assignment, bonusCurrencyReward: Number(event.target.value) };
                        onAssignmentDraftsChange(next);
                      }}
                    />
                  </td>
                  <td className="col-deadline">
                    <input
                      type="datetime-local"
                      value={toDateTimeLocalInputValue(assignment.deadline)}
                      aria-label="Deadline"
                      onChange={(event) => {
                        const next = [...assignmentDrafts];
                        next[index] = {
                          ...assignment,
                          deadline: fromDateTimeLocalInputValue(event.target.value),
                        };
                        onAssignmentDraftsChange(next);
                      }}
                    />
                  </td>
                  <td className="col-active">
                    <input
                      type="checkbox"
                      checked={assignment.active}
                      aria-label="Active"
                      onChange={(event) => {
                        const next = [...assignmentDrafts];
                        next[index] = { ...assignment, active: event.target.checked };
                        onAssignmentDraftsChange(next);
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          className="matrix-add-row"
          onClick={() => onAssignmentDraftsChange([...assignmentDrafts, createAssignmentDraft()])}
        >
          + Add assignment
        </button>
      </article>

      <section className="section submissions-section">
        <header className="section-header">
          <h2>Review student submissions</h2>
          <div className="submission-filters">
            <select
              value={submissionFilter.assignmentId}
              onChange={(event) => setSubmissionFilter({ ...submissionFilter, assignmentId: event.target.value })}
              aria-label="Filter by assignment"
            >
              <option value="">All assignments</option>
              {bootstrap.assignments.map((assignment) => (
                <option key={assignment.id} value={assignment.id}>
                  {assignment.title}
                </option>
              ))}
            </select>
            <select
              value={submissionFilter.status}
              onChange={(event) => setSubmissionFilter({ ...submissionFilter, status: event.target.value })}
              aria-label="Filter by status"
            >
              <option value="">All statuses</option>
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="OUTSTANDING">Outstanding</option>
              <option value="REJECTED">Rejected</option>
            </select>
          </div>
        </header>

        <div className="matrix-scroll">
          <table className="matrix-table submissions-table">
            <thead>
              <tr>
                <th scope="col">Assignment</th>
                <th scope="col">Student</th>
                <th scope="col">Group</th>
                <th scope="col">Text</th>
                <th scope="col">Image</th>
                <th scope="col">Status</th>
                <th scope="col">Submitted</th>
                <th scope="col" className="matrix-table__th--actions">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredSubmissions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="empty-cell">
                    No submissions match the current filters.
                  </td>
                </tr>
              ) : (
                filteredSubmissions.map((submission) => (
                  <tr key={submission.id}>
                    <td>{submission.assignment.title}</td>
                    <td>{submission.participant.discordUsername ?? submission.participant.indexId}</td>
                    <td>{submission.participant.group.displayName}</td>
                    <td className="submission-text-cell" title={submission.text}>
                      {submission.text.length > 80 ? `${submission.text.slice(0, 80)}...` : submission.text || "\u2014"}
                    </td>
                    <td>
                      {submission.imageUrl ? (
                        <a
                          href={submission.imageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="submission-image-link"
                        >
                          {VIDEO_URL_PATTERN.test(submission.imageUrl) ? (
                            <video
                              src={submission.imageUrl}
                              className="submission-thumbnail"
                              muted
                              playsInline
                              preload="metadata"
                              aria-label="Submission video preview"
                            />
                          ) : (
                            <img src={submission.imageUrl} alt="Submission" className="submission-thumbnail" />
                          )}
                        </a>
                      ) : (
                        "\u2014"
                      )}
                    </td>
                    <td>
                      <span className={`badge ${STATUS_CLASSES[submission.status]}`}>
                        {STATUS_LABELS[submission.status]}
                      </span>
                    </td>
                    <td>
                      <time dateTime={submission.createdAt}>{new Date(submission.createdAt).toLocaleDateString()}</time>
                    </td>
                    <td className="col-actions submission-actions">
                      {submission.status === "PENDING" ? (
                        reviewingId === submission.id ? (
                          <div className="review-buttons">
                            <button
                              className="btn-approve"
                              type="button"
                              onClick={() => {
                                void handleReview(submission, "APPROVED");
                              }}
                              disabled={isBusy}
                            >
                              Approve
                            </button>
                            <button
                              className="btn-outstanding"
                              type="button"
                              onClick={() => {
                                void handleReview(submission, "OUTSTANDING");
                              }}
                              disabled={isBusy}
                            >
                              Outstanding
                            </button>
                            <button
                              className="btn-reject"
                              type="button"
                              onClick={() => {
                                void handleReview(submission, "REJECTED");
                              }}
                              disabled={isBusy}
                            >
                              Reject
                            </button>
                            <button type="button" onClick={() => setReviewingId(null)} disabled={isBusy}>
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button type="button" onClick={() => setReviewingId(submission.id)} disabled={isBusy}>
                            Review
                          </button>
                        )
                      ) : (
                        <span className="review-done">
                          {submission.reviewedByUsername ? `by ${submission.reviewedByUsername}` : "Reviewed"}
                          {submission.pointsAwarded || submission.currencyAwarded
                            ? ` (+${submission.pointsAwarded ?? 0}pts, +${submission.currencyAwarded ?? 0}cur)`
                            : ""}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
