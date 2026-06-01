import path from 'node:path';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function startsWithBoundary(targetPath, rootPath) {
  return targetPath === rootPath || targetPath.startsWith(`${rootPath}${path.sep}`);
}

export function assertRelativeRegistryRootPath(rootPath, description) {
  if (!isNonEmptyString(rootPath)) {
    throw new Error(`${description} must be a non-empty relative path.`);
  }

  const normalizedRootPath = rootPath.trim();

  if (path.isAbsolute(normalizedRootPath)) {
    throw new Error(`${description} must not be absolute: ${normalizedRootPath}`);
  }

  const segments = normalizedRootPath.split(/[\\/]+/).filter(Boolean);

  if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`${description} contains invalid path segments: ${normalizedRootPath}`);
  }

  return normalizedRootPath;
}

export function resolveBoundedChildPath({
  parentRootPath,
  childRootPath,
  description,
}) {
  if (!isNonEmptyString(parentRootPath)) {
    throw new Error(`${description} requires a non-empty parentRootPath.`);
  }

  const normalizedChildRootPath = assertRelativeRegistryRootPath(childRootPath, description);
  const resolvedParentRootPath = path.resolve(parentRootPath);
  const resolvedChildRootPath = path.resolve(resolvedParentRootPath, normalizedChildRootPath);

  if (!startsWithBoundary(resolvedChildRootPath, resolvedParentRootPath)) {
    throw new Error(`${description} resolves outside the allowed parent root: ${normalizedChildRootPath}`);
  }

  return resolvedChildRootPath;
}
