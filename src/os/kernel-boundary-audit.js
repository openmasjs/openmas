const KERNEL_BOUNDARY_ROLES = Object.freeze({
  kernelStateAdapter: 'kernel_state_adapter',
  kernelOnly: 'kernel_only',
  systemCallSubmissionClient: 'system_call_submission_client',
  userModeSystemCallAffordance: 'user_mode_system_call_affordance',
  legacyDirectCliJobRunner: 'legacy_direct_cli_job_runner',
});

const KERNEL_BOUNDARY_MODULE_CLASSIFICATIONS = Object.freeze({
  'src/os/actions/mas-os-delegate-runtime.js': {
    role: KERNEL_BOUNDARY_ROLES.userModeSystemCallAffordance,
    allowedReason: 'AI-native user-mode affordance. It may submit delegate System Calls but must not materialize kernel state directly.',
  },
  'src/os/actions/mas-os-schedule-delegation-runtime.js': {
    role: KERNEL_BOUNDARY_ROLES.userModeSystemCallAffordance,
    allowedReason: 'AI-native user-mode affordance. It may submit schedule_delegation System Calls but must not materialize kernel state directly.',
  },
  'src/os/adapters/local-runtime-adapter.js': {
    role: KERNEL_BOUNDARY_ROLES.kernelStateAdapter,
    allowedReason: 'Local persistence adapter used by kernel-mode services, processors, schedulers, dispatchers, and tests.',
  },
  'src/os/conversations/multi-agent-conversation-manager.js': {
    role: KERNEL_BOUNDARY_ROLES.kernelOnly,
    allowedReason: 'Kernel conversation manager for OS-managed conversation state.',
  },
  'src/os/delegation/delegation-manager.js': {
    role: KERNEL_BOUNDARY_ROLES.kernelOnly,
    allowedReason: 'Kernel delegation manager used by the System Call processor and OS service paths.',
  },
  'src/os/manual-job-execution.js': {
    role: KERNEL_BOUNDARY_ROLES.kernelOnly,
    allowedReason: 'Kernel dispatch helper that runs admitted Jobs and updates Process/Thread/Job state.',
  },
  'src/os/scheduler/local-scheduler-dispatcher.js': {
    role: KERNEL_BOUNDARY_ROLES.kernelOnly,
    allowedReason: 'Kernel dispatcher for ready Thread execution.',
  },
  'src/os/scheduler/one-shot-scheduled-jobs.js': {
    role: KERNEL_BOUNDARY_ROLES.kernelOnly,
    allowedReason: 'Kernel scheduler for one-shot Job and Timer state.',
  },
  'src/os/scheduler/recurring-jobs.js': {
    role: KERNEL_BOUNDARY_ROLES.kernelOnly,
    allowedReason: 'Kernel scheduler for recurring Job and Timer state.',
  },
  'src/os/service/kernel-lock.js': {
    role: KERNEL_BOUNDARY_ROLES.kernelOnly,
    allowedReason: 'Kernel singleton lock and lock audit support.',
  },
  'src/os/service/local-os-service.js': {
    role: KERNEL_BOUNDARY_ROLES.kernelOnly,
    allowedReason: 'Local OS service tick implementation. This is kernel mode.',
  },
  'src/os/service/openmas-os-service-cli.js': {
    role: KERNEL_BOUNDARY_ROLES.kernelOnly,
    allowedReason: 'OS service command surface. It may run kernel ticks or submit validated System Calls.',
  },
  'src/os/signals/signal-manager.js': {
    role: KERNEL_BOUNDARY_ROLES.kernelOnly,
    allowedReason: 'Kernel signal manager for protected Job, Timer, Process, and Thread state transitions.',
  },
  'src/os/system-calls/local-system-call-inbox.js': {
    role: KERNEL_BOUNDARY_ROLES.systemCallSubmissionClient,
    allowedReason: 'Append-only System Call intake and result reader. It must not materialize Jobs, Timers, Processes, or Threads.',
  },
  'src/os/system-calls/system-call-client.js': {
    role: KERNEL_BOUNDARY_ROLES.systemCallSubmissionClient,
    allowedReason: 'User-mode client for submitting validated System Calls and optionally waiting for kernel results.',
  },
  'src/os/system-calls/system-call-processor.js': {
    role: KERNEL_BOUNDARY_ROLES.kernelOnly,
    allowedReason: 'Kernel System Call processor. It converts governed requests into authoritative OS effects.',
  },
  'bin/invoke-agent.js': {
    role: KERNEL_BOUNDARY_ROLES.legacyDirectCliJobRunner,
    allowedReason: 'Known direct CLI Job runner from the pre-service path. It is explicit technical debt and must not be copied by new user-mode affordances.',
  },
});

const USER_MODE_OS_AFFORDANCE_MODULES = Object.freeze([
  'src/os/actions/mas-os-delegate-runtime.js',
  'src/os/actions/mas-os-schedule-delegation-runtime.js',
]);

const KERNEL_MUTATION_SYMBOLS = Object.freeze([
  'createLocalRuntimeAdapter',
  'persistJob',
  'persistTimer',
  'persistProcess',
  'persistThread',
  'persistResultRecord',
  'appendEvent',
  'createJob',
  'admitJob',
  'runJobNow',
  'scheduleOneShotJob',
  'releaseDueOneShotJobs',
  'delegateToOperationalIdentity',
  'createKernelSystemCallProcessor',
]);

const SYSTEM_CALL_SUBMISSION_SYMBOLS = Object.freeze([
  'submitOpenMasOsSystemCall',
  'createLocalSystemCallInbox',
]);

function normalizeBoundaryPath(filePath) {
  return filePath.replaceAll('\\', '/');
}

function classifyKernelBoundaryModule(filePath) {
  const normalizedPath = normalizeBoundaryPath(filePath);

  return KERNEL_BOUNDARY_MODULE_CLASSIFICATIONS[normalizedPath] ?? null;
}

export {
  KERNEL_BOUNDARY_MODULE_CLASSIFICATIONS,
  KERNEL_BOUNDARY_ROLES,
  KERNEL_MUTATION_SYMBOLS,
  SYSTEM_CALL_SUBMISSION_SYMBOLS,
  USER_MODE_OS_AFFORDANCE_MODULES,
  classifyKernelBoundaryModule,
  normalizeBoundaryPath,
};
