type CommitAction = 'create' | 'update';

export type GitLabCommitResult = {
  action: CommitAction;
  commitId: string;
  webUrl?: string;
};

const gitlabHeaders = (token: string) => ({
  'Content-Type': 'application/json',
  'PRIVATE-TOKEN': token,
});

export const upsertGitlabFile = async ({
  baseUrl,
  token,
  projectId,
  branch,
  filePath,
  content,
  commitMessage,
}: {
  baseUrl: string;
  token: string;
  projectId: string;
  branch: string;
  filePath: string;
  content: string;
  commitMessage: string;
}): Promise<GitLabCommitResult> => {
  const encodedPath = encodeURIComponent(filePath);
  const fileCheckUrl = `${baseUrl}/api/v4/projects/${encodeURIComponent(projectId)}/repository/files/${encodedPath}?ref=${encodeURIComponent(branch)}`;
  const fileCheckResponse = await fetch(fileCheckUrl, {
    headers: gitlabHeaders(token),
  });

  const action: CommitAction = fileCheckResponse.ok ? 'update' : 'create';

  const commitUrl = `${baseUrl}/api/v4/projects/${encodeURIComponent(projectId)}/repository/commits`;
  const commitResponse = await fetch(commitUrl, {
    method: 'POST',
    headers: gitlabHeaders(token),
    body: JSON.stringify({
      branch,
      commit_message: commitMessage,
      actions: [
        {
          action,
          file_path: filePath,
          content,
        },
      ],
    }),
  });

  if (!commitResponse.ok) {
    const errorBody = await commitResponse.text();
    throw new Error(
      `GitLab commit failed (${commitResponse.status}): ${errorBody}`,
    );
  }

  const commitResult = await commitResponse.json();
  return {
    action,
    commitId: commitResult.id as string,
    webUrl: commitResult.web_url as string | undefined,
  };
};
