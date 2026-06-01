import { assertInstructionLayers } from '../contracts/brain/instruction-layer-contract.js';
import {
  assertPromptBudgetPolicy,
  assertPromptBudgetReport,
} from '../contracts/prompts/prompt-budget-contract.js';
import {
  DEFAULT_ESTIMATED_CHARACTERS_PER_TOKEN,
  estimateInstructionLayersSize,
  estimatePromptContentSize,
} from './estimate-prompt-size.js';

const DEFAULT_PROMPT_BUDGET_POLICY = {
  kind: 'prompt_budget_policy',
  version: 1,
  promptBudgetPolicyId: 'default-prompt-budget-policy-v1',
  maxSystemInstructionCharacters: 64000,
  estimatedCharactersPerToken: DEFAULT_ESTIMATED_CHARACTERS_PER_TOKEN,
  layerRules: [
    {
      layerType: 'framework_runtime',
      action: 'preserve',
    },
    {
      layerType: 'mas_policy',
      action: 'preserve',
    },
    {
      layerType: 'operational_identity',
      action: 'preserve',
    },
    {
      layerType: 'cognitive_identity',
      action: 'preserve',
    },
    {
      layerType: 'policy',
      action: 'preserve',
    },
    {
      layerType: 'capability',
      action: 'preserve',
    },
    {
      layerType: 'execution_guard',
      action: 'preserve',
    },
    {
      layerType: 'tool_availability',
      action: 'compress',
      maxContentCharacters: 10000,
      minContentCharacters: 1800,
      reductionPriority: 60,
    },
    {
      layerType: 'workflow',
      action: 'compress',
      maxContentCharacters: 10000,
      minContentCharacters: 1600,
      reductionPriority: 70,
    },
    {
      layerType: 'context_pack',
      action: 'compress',
      maxContentCharacters: 18000,
      minContentCharacters: 2400,
      reductionPriority: 80,
    },
    {
      layerType: 'few_shot',
      action: 'compress',
      maxContentCharacters: 8000,
      minContentCharacters: 1400,
      reductionPriority: 100,
    },
  ],
  warnings: [],
};

function sortLayers(left, right) {
  if (left.priority !== right.priority) {
    return left.priority - right.priority;
  }

  return left.layerId.localeCompare(right.layerId);
}

function buildRuleMap(policy) {
  return new Map(policy.layerRules.map((rule) => {
    return [rule.layerType, rule];
  }));
}

function getLayerRule({ layer, ruleMap }) {
  return ruleMap.get(layer.layerType) ?? {
    layerType: layer.layerType,
    action: 'preserve',
    maxContentCharacters: null,
    minContentCharacters: null,
    reductionPriority: 0,
  };
}

function summarizeSourceReferences(sourceReferences) {
  if (!Array.isArray(sourceReferences) || sourceReferences.length === 0) {
    return 'none';
  }

  return sourceReferences.map((sourceReference) => {
    return [
      sourceReference.sourceType,
      sourceReference.sourceId,
      sourceReference.path ? `(${sourceReference.path})` : null,
    ].filter(Boolean).join(' ');
  }).join(', ');
}

function buildCompressionNotice({
  layer,
  originalCharacters,
  targetCharacters,
  reason,
}) {
  const header = [
    `## Prompt Budget Compression Notice: ${layer.layerId}`,
    `Layer Type: ${layer.layerType}`,
    `Owner: ${layer.owner}`,
    `Reason: ${reason}`,
    `Original Characters: ${originalCharacters}`,
    `Target Characters: ${targetCharacters}`,
    `Source References: ${summarizeSourceReferences(layer.sourceReferences)}`,
    `Layer Summary: ${layer.summary ?? 'none'}`,
    '',
    'The original layer was reduced deterministically before provider request assembly.',
    'This notice is intentionally visible so context loss is never silent.',
    'Do not infer omitted details, permissions, policies, facts, or workflow authority from omitted content.',
    '',
    '## Retained Layer Excerpt',
  ].join('\n');
  const footer = [
    '',
    '## Omitted Layer Content',
    'Additional layer content was omitted by the Prompt Budgeting and Compression subsystem.',
    'Use prompt provenance and source references to audit which sources contributed to this compressed layer.',
  ].join('\n');
  const reservedCharacters = header.length + footer.length + 2;
  const excerptCharacters = Math.max(0, targetCharacters - reservedCharacters);
  const excerpt = excerptCharacters > 0
    ? layer.content.slice(0, excerptCharacters).trim()
    : 'No raw excerpt retained because the target budget was reserved for the compression notice.';

  return [
    header,
    excerpt,
    footer,
  ].join('\n');
}

function estimateContent(content, policy) {
  return estimatePromptContentSize({
    content,
    estimatedCharactersPerToken: policy.estimatedCharactersPerToken,
  });
}

function buildDecision({
  layer,
  decisionType,
  reason,
  beforeContent,
  afterContent,
  policy,
}) {
  return {
    layerId: layer.layerId,
    layerType: layer.layerType,
    decisionType,
    reason,
    before: estimateContent(beforeContent, policy),
    after: estimateContent(afterContent, policy),
  };
}

function determineInitialTargets({ layers, ruleMap }) {
  return layers.map((layer, index) => {
    const rule = getLayerRule({
      layer,
      ruleMap,
    });
    const originalCharacters = layer.content.length;
    const maxContentCharacters = rule.action === 'compress'
      ? rule.maxContentCharacters
      : null;
    const minContentCharacters = rule.action === 'compress'
      ? rule.minContentCharacters ?? Math.min(maxContentCharacters, originalCharacters)
      : null;
    const targetCharacters = rule.action === 'compress' && maxContentCharacters !== null
      ? Math.min(originalCharacters, maxContentCharacters)
      : originalCharacters;

    return {
      index,
      layer,
      rule,
      originalCharacters,
      targetCharacters,
      minContentCharacters,
    };
  });
}

function reduceTargetsToGlobalBudget({ targets, maxSystemInstructionCharacters }) {
  let currentTargetTotal = targets.reduce((total, target) => {
    return total + target.targetCharacters;
  }, 0);
  let overage = currentTargetTotal - maxSystemInstructionCharacters;

  if (overage <= 0) {
    return;
  }

  const reducibleTargets = targets
    .filter((target) => {
      return target.rule.action === 'compress' && target.targetCharacters > target.minContentCharacters;
    })
    .toSorted((left, right) => {
      if (left.rule.reductionPriority !== right.rule.reductionPriority) {
        return right.rule.reductionPriority - left.rule.reductionPriority;
      }

      if (left.layer.priority !== right.layer.priority) {
        return right.layer.priority - left.layer.priority;
      }

      return left.layer.layerId.localeCompare(right.layer.layerId);
    });

  for (const target of reducibleTargets) {
    if (overage <= 0) {
      break;
    }

    const availableReduction = target.targetCharacters - target.minContentCharacters;
    const appliedReduction = Math.min(availableReduction, overage);

    target.targetCharacters -= appliedReduction;
    overage -= appliedReduction;
    currentTargetTotal -= appliedReduction;
  }
}

export function createDefaultPromptBudgetPolicy(overrides = {}) {
  return assertPromptBudgetPolicy({
    ...DEFAULT_PROMPT_BUDGET_POLICY,
    ...overrides,
    layerRules: overrides.layerRules ?? DEFAULT_PROMPT_BUDGET_POLICY.layerRules,
    warnings: overrides.warnings ?? DEFAULT_PROMPT_BUDGET_POLICY.warnings,
  });
}

export function applyPromptBudgetToInstructionLayers({
  instructionLayers,
  promptBudgetPolicy = createDefaultPromptBudgetPolicy(),
} = {}) {
  const policy = assertPromptBudgetPolicy(promptBudgetPolicy);
  const layers = assertInstructionLayers(instructionLayers).toSorted(sortLayers);
  const before = estimateInstructionLayersSize({
    instructionLayers: layers,
    estimatedCharactersPerToken: policy.estimatedCharactersPerToken,
  });
  const ruleMap = buildRuleMap(policy);
  const targets = determineInitialTargets({
    layers,
    ruleMap,
  });

  reduceTargetsToGlobalBudget({
    targets,
    maxSystemInstructionCharacters: policy.maxSystemInstructionCharacters,
  });

  const adjustedLayers = targets.map((target) => {
    if (target.targetCharacters >= target.originalCharacters) {
      return target.layer;
    }

    const reason = target.originalCharacters > target.rule.maxContentCharacters
      ? `Layer exceeded maxContentCharacters for ${target.layer.layerType}.`
      : 'Global system instruction budget required layer compression.';
    const compressedContent = buildCompressionNotice({
      layer: target.layer,
      originalCharacters: target.originalCharacters,
      targetCharacters: target.targetCharacters,
      reason,
    });

    return {
      ...target.layer,
      content: compressedContent,
      summary: `${target.layer.summary ?? target.layer.layerId} Compressed by Prompt Budgeting and Compression.`,
      warnings: [
        ...target.layer.warnings,
        `Prompt Budget: compressed ${target.layer.layerId} from ${target.originalCharacters} to ${compressedContent.length} characters.`,
      ],
    };
  });
  const normalizedAdjustedLayers = assertInstructionLayers(adjustedLayers).toSorted(sortLayers);
  const after = estimateInstructionLayersSize({
    instructionLayers: normalizedAdjustedLayers,
    estimatedCharactersPerToken: policy.estimatedCharactersPerToken,
  });
  const decisions = targets.map((target) => {
    const adjustedLayer = normalizedAdjustedLayers[target.index];
    const wasCompressed = adjustedLayer.content !== target.layer.content;

    if (wasCompressed) {
      return buildDecision({
        layer: target.layer,
        decisionType: 'compressed',
        reason: adjustedLayer.warnings.at(-1),
        beforeContent: target.layer.content,
        afterContent: adjustedLayer.content,
        policy,
      });
    }

    const isOverBudgetProtected = after.characters > policy.maxSystemInstructionCharacters
      && target.rule.action === 'preserve';

    return buildDecision({
      layer: target.layer,
      decisionType: isOverBudgetProtected ? 'over_budget' : 'kept',
      reason: isOverBudgetProtected
        ? 'Protected layer was preserved even though the final prompt remains over budget.'
        : 'Layer remained within the prompt budget policy.',
      beforeContent: target.layer.content,
      afterContent: adjustedLayer.content,
      policy,
    });
  });
  const status = after.characters <= policy.maxSystemInstructionCharacters
    ? (decisions.some((decision) => decision.decisionType === 'compressed') ? 'compressed' : 'within_budget')
    : 'over_budget';
  const warnings = [
    ...policy.warnings,
    ...decisions
      .filter((decision) => decision.decisionType === 'compressed')
      .map((decision) => {
        return `Prompt Budget: ${decision.layerId} was compressed from ${decision.before.characters} to ${decision.after.characters} characters.`;
      }),
    ...(status === 'over_budget'
      ? [`Prompt Budget: final system instructions remain over budget (${after.characters}/${policy.maxSystemInstructionCharacters} characters).`]
      : []),
  ];
  const report = assertPromptBudgetReport({
    kind: 'prompt_budget_report',
    version: 1,
    promptBudgetPolicyId: policy.promptBudgetPolicyId,
    status,
    before: {
      characters: before.characters,
      estimatedTokens: before.estimatedTokens,
    },
    after: {
      characters: after.characters,
      estimatedTokens: after.estimatedTokens,
    },
    decisions,
    warnings,
  });

  return {
    instructionLayers: normalizedAdjustedLayers,
    promptBudgetReport: report,
  };
}

export {
  DEFAULT_PROMPT_BUDGET_POLICY,
};
