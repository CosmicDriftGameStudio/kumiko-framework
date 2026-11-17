import { dirname, join, resolve } from "node:path";
import { Project, type ResolutionHostFactory, ts } from "ts-morph";

function isZodSpecifier(moduleName: string): boolean {
  return moduleName === "zod" || moduleName.startsWith("zod/");
}

// A second zod nested under a package makes the checker compare schemas structurally across both
// copies at every framework call, which exhausts memory; one copy keeps them nominal.
function appRootZodResolution(appRoot: string): ResolutionHostFactory {
  const appRootAnchor = join(appRoot, "codemod-resolution-anchor.ts");
  return (moduleResolutionHost, getCompilerOptions) => {
    const cache = ts.createModuleResolutionCache(
      appRoot,
      (fileName) => fileName,
      getCompilerOptions(),
    );
    const resolveFrom = (moduleName: string, containingFile: string, options: ts.CompilerOptions) =>
      ts.resolveModuleName(moduleName, containingFile, options, moduleResolutionHost, cache)
        .resolvedModule;
    return {
      resolveModuleNames: (
        moduleNames,
        containingFile,
        _reusedNames,
        _redirectedReference,
        options,
      ) =>
        moduleNames.map(
          (moduleName) =>
            (isZodSpecifier(moduleName)
              ? resolveFrom(moduleName, appRootAnchor, options)
              : undefined) ?? resolveFrom(moduleName, containingFile, options),
        ),
    };
  };
}

export function createTypeAwareProject(tsconfig: string | undefined): Project {
  if (tsconfig === undefined) return new Project({ skipAddingFilesFromTsConfig: true });
  const tsConfigFilePath = resolve(tsconfig);
  return new Project({
    tsConfigFilePath,
    skipAddingFilesFromTsConfig: true,
    resolutionHost: appRootZodResolution(dirname(tsConfigFilePath)),
  });
}
