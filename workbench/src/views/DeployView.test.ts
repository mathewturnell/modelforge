import {describe, expect, it} from "vitest";
import {deploymentPresentation, mergeDeploymentResponses} from "./DeployView";

describe("deployment status projection", () => {
  it("retains authoritative POST success when a best-effort status refresh fails", () => {
    const published = {
      configured: true,
      deployment: {
        release_id: "release-1", launch_url: "https://app.example.test",
        billing_state: "failed", billing_notice: "Deployment succeeded; reconciliation pending.",
        file_count: 3,
      },
    };
    expect(mergeDeploymentResponses(published, null)).toEqual(published);
    expect(mergeDeploymentResponses(published, {
      configured: true, deployment: {release_id: "release-1", state: "active"},
    }).deployment).toEqual({...published.deployment, state: "active"});
  });

  it("labels failed billing reporting as an active deployment with reconciliation pending", () => {
    expect(deploymentPresentation({billing_state: "failed"})).toEqual({
      badgeTone: "warning",
      badgeLabel: "Active · Billing pending",
      billingNotice: "Deployment succeeded; activation fee reporting is pending operator reconciliation.",
    });
  });
});
