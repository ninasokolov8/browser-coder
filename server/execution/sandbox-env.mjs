/**
 * The environment every sandboxed child process receives.
 *
 * Built from nothing rather than inherited: `process.env` is never spread in, so
 * a secret, token or credential present in the API container cannot reach a
 * student's program by accident. Anything a runtime needs is listed explicitly.
 *
 * Extracted so buffered runs, interactive sessions, compilers and linters share
 * exactly one security posture. In the pre-refactor code the interactive spawner
 * and `runProcess` built the environment separately, which is the shape of
 * mistake that ends with one path being hardened and the other not.
 */

/**
 * @param {object} options
 * @param {string} options.jobDir      the run's private directory
 * @param {object} options.config      CONFIG
 * @param {Record<string,string>} [options.extra] adapter-supplied additions,
 *   e.g. the graphics channel path
 */
export function buildSandboxEnv({ jobDir, config, extra = {} }) {
  // PATH: locked to the minimal Linux set in production. Development adds the
  // host PATH so tools are discoverable on a macOS or Windows machine, where
  // toolchains are not in /usr/bin.
  const productionPath = '/usr/local/bin:/usr/bin:/bin';
  const separator = process.platform === 'win32' ? ';' : ':';
  const developmentPath = config.isDev ? process.env.PATH || '' : '';
  const searchPath = developmentPath
    ? `${developmentPath}${separator}${productionPath}`
    : productionPath;

  return {
    PATH: searchPath,

    // HOME and every temp variable point at the job's own directory, so a
    // runtime that writes a cache, a lock file or a crash dump does it inside the
    // directory that will be deleted - not into a shared location another job can
    // see. Previously all of these pointed at the shared temp root.
    HOME: jobDir,
    TMPDIR: jobDir,
    TEMP: jobDir,
    TMP: jobDir,

    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',

    PYTHONUNBUFFERED: '1',
    PYTHONDONTWRITEBYTECODE: '1',

    NODE_OPTIONS: '--max-old-space-size=128',

    // .NET first-run ceremony. DOTNET_CLI_HOME is the important one and is easy
    // to get wrong: the CLI writes its first-run sentinel there, NOT to HOME, and
    // the banner-suppressing variables do not skip that write. In production the
    // container is read-only, so leaving it at the default /home/app makes the
    // first-run configurer throw - which then surfaces as an unrelated-looking
    // NETSDK1004 "assets file not found" on every single C# run.
    DOTNET_NOLOGO: '1',
    DOTNET_CLI_TELEMETRY_OPTOUT: '1',
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1',
    DOTNET_GENERATE_ASPNET_CERTIFICATE: 'false',
    DOTNET_SKIP_WORKLOAD_INTEGRITY_CHECK: '1',
    DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE: '1',
    DOTNET_CLI_HOME: jobDir,

    // JAVA_TOOL_OPTIONS is deliberately NOT set.
    //
    // It looks like the natural place for a heap limit, and it was used for one.
    // But the JVM announces it on stderr at every startup:
    //
    //     Picked up JAVA_TOOL_OPTIONS: -Xmx128m
    //
    // which lands in the student's error output on every single Java run - noise
    // they cannot act on, sitting above their own stack traces, and indenting the
    // service's implementation details into their workspace. It was also
    // redundant: the Java adapter passes `-Xmx128m` to the launcher and
    // `-J-Xmx128m` to javac explicitly, which is both quieter and more precise,
    // since the two processes can then be limited independently.
    //
    // Verified in the production image: with this removed, a Java run's stderr is
    // empty for a program that prints nothing to it.

    ...extra,
  };
}
