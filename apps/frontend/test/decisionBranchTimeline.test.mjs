import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDecisionTimelineFlow } from '../src/decisionBranchTreeModel.js';

test('selected paths keep continuity while rejected or deferred options stay off the genesis chain', () => {
  const analysisReport = {
    objectives: [
      {
        id: 'objective-1',
        label: 'Objective 1',
        description: 'Primary decision path',
        majorFunctionalityIds: ['feature-1', 'feature-2']
      }
    ],
    majorFunctionalities: [
      { id: 'feature-1', objectiveId: 'objective-1', label: 'Feature one', category: 'ui' },
      { id: 'feature-2', objectiveId: 'objective-1', label: 'Feature two', category: 'api' }
    ]
  };

  const branches = [
    {
      id: 'selected-a',
      status: 'selected',
      objective: { summary: 'Selected path A' },
      candidate: { functionalityId: 'feature-1', inferenceRole: 'observed_current' },
      parentBranchId: '',
      createdAt: '2026-08-01T00:00:00.000Z'
    },
    {
      id: 'deferred-a',
      status: 'deferred',
      objective: { summary: 'Deferred option A' },
      candidate: { functionalityId: 'feature-1', inferenceRole: 'deferred_alternative' },
      parentBranchId: '',
      createdAt: '2026-08-01T00:05:00.000Z'
    },
    {
      id: 'selected-b',
      status: 'selected',
      objective: { summary: 'Selected path B' },
      candidate: { functionalityId: 'feature-2', inferenceRole: 'observed_current' },
      parentBranchId: '',
      createdAt: '2026-08-01T00:10:00.000Z'
    },
    {
      id: 'deferred-b',
      status: 'deferred',
      objective: { summary: 'Deferred option B' },
      candidate: { functionalityId: 'feature-2', inferenceRole: 'deferred_alternative' },
      parentBranchId: '',
      createdAt: '2026-08-01T00:15:00.000Z'
    }
  ];

  const layout = buildDecisionTimelineFlow({
    projectId: 'project-1',
    projectName: 'Demo project',
    branches,
    analysisReport
  });

  const genesisLinks = layout.links.filter((link) => link.source?.id === layout.genesis.id);
  assert.equal(genesisLinks.length, 1, 'Only the first selected path should anchor the continuity chain to genesis');
  assert.equal(genesisLinks[0].targetBranchId, 'selected-a', 'The continuity chain should start from the initial selected branch');
  assert.ok(
    layout.links.some((link) => link.sourceBranchId === 'selected-a' && link.targetBranchId === 'selected-b'),
    'The selected path should continue from the previous selected node'
  );
  assert.ok(
    !layout.links.some((link) => link.source?.id === layout.genesis.id && link.targetBranchId === 'deferred-a'),
    'Deferred or rejected options must not sit on the genesis lineage'
  );
  assert.ok(
    !layout.links.some((link) => link.source?.id === layout.genesis.id && link.targetBranchId === 'deferred-b'),
    'Deferred options should remain side nodes rather than root nodes'
  );
});
