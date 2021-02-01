import * as core from '@actions/core';
import {context, getOctokit} from '@actions/github'

async function run() {
  const token = core.getInput('github-token', {required: true})
  const step = core.getInput('step', {required: true})
  const deployOutcome = core.getInput('deploy-outcome')
  const labelName = core.getInput('label-name')
  const checkName = core.getInput('check-name')
  const debug = core.getInput('debug')
  const userAgent = core.getInput('user-agent')
  const previews = core.getInput('previews')
  const statusMessage = 'Set ' + labelName + ' label to this pull request only, and re-run to deploy.'
  const opts = {}
  if (debug === 'true') opts.log = console
  if (userAgent != null) opts.userAgent = userAgent
  if (previews != null) opts.previews = previews.split(',')

  const github = getOctokit(token, opts)

  // This action for pull_request only.
  if (!context.payload.pull_request) {
    console.log('This action for pull request only.')
    return
  }
  const prNumber = context.payload.pull_request.number

  if (step == 'check-deployable') {
    // check deployable from pull_request label
    try {

      core.startGroup('Checking Label of self-PR')
      const prLabels = (await github.graphql(
        `query($owner:String!, $name:String!, $number:Int!) {
          repository(owner:$owner, name:$name){
            pullRequest(number:$number) {
              labels(first:100) {
                nodes { name }
              }
            }
          }
        }`,
        {
          owner: context.repo.owner,
          name: context.repo.repo,
          number: prNumber
        }
      )).repository.pullRequest.labels
      const labeled = prLabels.nodes.filter(x => x.name=labelName).length > 0
      if (!labeled) {
        console.log('#' + prNumber + ' do NOT have label: ' + labelName)
      }
      core.endGroup()

      core.startGroup('Checking Label of open-PRs')
      const dupPrlist = await github.graphql(
        `query($owner:String!, $name:String!, $label:String!) {
          repository(owner:$owner, name:$name){
            pullRequests(first:100, states:OPEN, labels: [$label]) {
              nodes { number }
            }
          }
        }`,
        {
          owner: context.repo.owner,
          name: context.repo.repo,
          label: labelName
        }
      )
      const nonDup = dupPrlist.repository.pullRequests.nodes.length == labeled ? 1 : 0
      if (!nonDup) {
        console.log('Another pull request has label: ' + labelName)
        console.log(dupPrlist.repository.pullRequests.nodes)
      }
      core.endGroup()

      if(labeled && nonDup) {
        console.log('#' + prNumber + ' is staging target.')
      } else {
        console.log('#' + prNumber + ' is NOT staging target.')
      }

      core.startGroup('Make open-PRs\' checks pending')
      if (labeled && nonDup) {
        const dupPrlist = await github.graphql(
          `query($owner:String!, $name:String!, $label:String!, $check:String!) {
            repository(owner:$owner, name:$name){
              pullRequests(first:100, states:OPEN, labels: [$label]) {
                nodes {
                  number
                  commits(last:1) {
                    nodes {
                      commit {
                        oid
                        status {
                          context(name: $check) { state }
                        }
                      }
                    }
                  }
                }
              }
            }
          }`,
          {
            owner: context.repo.owner,
            name: context.repo.repo,
            label: labelName,
            check: checkName
          }
        )
        const successes = dupPrlist.repository.pullRequests.nodes.filter(nc =>
          nc.number != prNumber && nc.commits.nodes[0].commit.status.context.state == 'SUCCESS'
        )
        for (const nc of successes) {
          const resp = await github.repos.createCommitStatus({
            owner: context.repo.owner,
            repo: context.repo.repo,
            sha: nc.commits.nodes[0].commit.oid,
            context: checkName,
            state: 'pending',
            target_url: 'https://github.com/' + context.repo.owner + '/' + context.repo.repo + '/pull/' + nc.number + '/checks',
            description: statusMessage
          });
          console.log("Make commit " + nc.commits.nodes[0].commit.oid + " pending.")
          if (parseInt(resp.status / 100) != 2) {
            console.log(resp)
            core.setFailed('Create commit status failed.');
            return
          }
        }
      }
      core.endGroup()

      core.startGroup('Make self-PR\'s checks pending')
      const prSha = (await github.graphql(
        `query($owner:String!, $name:String!, $number:Int!) {
          repository(owner:$owner, name:$name){
            pullRequest(number:$number) {
              commits(last:1) {
                nodes {
                  commit { oid }
                }
              }
            }
          }
        }`,
        {
          owner: context.repo.owner,
          name: context.repo.repo,
          number: prNumber
        }
      )).repository.pullRequest.commits.nodes[0].commit.oid
      console.log("A latest commit of this pull request: " + prSha)
      const resp = await github.repos.createCommitStatus({
        owner: context.repo.owner,
        repo: context.repo.repo,
        sha: prSha,
        context: checkName,
        state: 'pending',
        target_url: 'https://github.com/' + context.repo.owner + '/' + context.repo.repo + '/pull/' + prNumber + '/checks',
        description: labeled && nonDup ? 'In-progress' : statusMessage
      });
      console.log("Make commit " + prSha + " pending.")
      if (parseInt(resp.status / 100) != 2) {
        console.log(resp)
        core.setFailed('Create commit status failed.');
        return
      }
      core.endGroup()

      core.setOutput('staging', labeled && nonDup)

    } catch (e) {
      core.setFailed(e.message);
    }

  } else if (step == 'apply-status') {
    // update check status of deployment (post process)
    try {

      core.startGroup('Make self-PR\'s checks sucess or failure')
      const deployState = deployOutcome == 'success' || deployOutcome == 'failure' ? deployOutcome : null
      if (deployState != null) {
        const prSha = (await github.graphql(
          `query($owner:String!, $name:String!, $number:Int!) {
            repository(owner:$owner, name:$name){
              pullRequest(number:$number) {
                commits(last:1) {
                  nodes {
                    commit { oid }
                  }
                }
              }
            }
          }`,
          {
            owner: context.repo.owner,
            name: context.repo.repo,
            number: prNumber
          }
        )).repository.pullRequest.commits.nodes[0].commit.oid
        console.log("A latest commit of this pull request: " + prSha)
  
        const resp = await github.repos.createCommitStatus({
          owner: context.repo.owner,
          repo: context.repo.repo,
          sha: prSha,
          context: checkName,
          state: deployState
        });
        console.log("Make commit " + prSha + " " + deployState + ".")
        if (parseInt(resp.status / 100) != 2) {
          console.log(resp)
          core.setFailed('Create commit status failed.');
          return
        }
      }
      core.endGroup()

    } catch (e) {
      core.setFailed(e.message);
    }

  } else {
    core.setFailed('Invalid step name.');

  }
}

run()
