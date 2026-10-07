import { describe, expect, it } from 'vitest';
import { Uri } from 'vscode';
import { parseConfig } from '../src/core/config';
import { Project, relative, sameUri } from '../src/project';

const folder = { name: 'repo', index: 0, uri: Uri.file('/repo') };

function project(json: string) {
  return new Project(folder, parseConfig(json, 'repo'));
}

describe('Project paths', () => {
  const p = project(
    '{"target":".env","example":".env.example","envs":[{"title":"Local","file":"envs\\\\.env.local"}],' +
      '"apps":[{"dir":"."},{"dir":"apps/web"},{"dir":"apps\\\\api","target":"config/.env"}]}',
  );
  const [root, web, api] = p.apps;

  it('resolves app folders, including the root and backslashes', () => {
    expect(root.dirUri.path).toBe('/repo');
    expect(web.dirUri.path).toBe('/repo/apps/web');
    expect(api.dirUri.path).toBe('/repo/apps/api');
  });

  it('resolves targets and env files inside each app', () => {
    expect(api.targetUri.path).toBe('/repo/apps/api/config/.env');
    expect(web.exampleUri?.path).toBe('/repo/apps/web/.env.example');
    expect(web.envUri(web.envs[0]).path).toBe('/repo/apps/web/envs/.env.local');
  });

  it('finds which app and env a file belongs to', () => {
    const found = p.findEnvFile(Uri.file('/repo/apps/api/envs/.env.local'));
    expect(found?.app.name).toBe('api');
    expect(found?.env.title).toBe('Local');
    expect(p.findEnvFile(Uri.file('/repo/apps/api/.env'))).toBeUndefined();
    expect(p.isExample(Uri.file('/repo/.env.example'))).toBe(true);
  });

  it('formats paths relative to the workspace folder', () => {
    expect(relative(p, api.targetUri)).toBe('apps/api/config/.env');
  });
});

describe('Project envs', () => {
  const p = project(
    '{"envs":[{"title":"Local","file":".env.local"},{"title":"Dev","file":".env.dev"}],' +
      '"apps":[{"dir":"web"},{"dir":"api","envs":[{"title":"Dev","file":null},{"title":"Mock","file":".env.mock"}]}]}',
  );

  it('lists every env title, shared first', () => {
    expect(p.allTitles()).toEqual(['Local', 'Dev', 'Mock']);
  });

  it('knows which apps have an env', () => {
    expect(p.appsWithEnv('Dev').map((a) => a.name)).toEqual(['web']);
    expect(p.appsWithEnv('Mock').map((a) => a.name)).toEqual(['api']);
    expect(p.findEnvTitle('.env.mock')).toBe('Mock');
    expect(p.findEnv('Mock')?.shared).toBe(false);
  });
});

describe('sameUri', () => {
  it('compares scheme and path', () => {
    expect(sameUri(Uri.file('/a/b'), Uri.file('/a/b'))).toBe(true);
    expect(sameUri(Uri.file('/a/b'), Uri.file('/a/c'))).toBe(false);
  });
});
