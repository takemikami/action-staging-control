action-staging-control
---

This action control deployment for staging with GitHub pull request. You can check developping application of pull request on staging environment, before production release.

## Usage

### setup

Add following workflow to your repository.

```yaml
name: staging
on: [pull_request]

jobs:
  test_and_staging:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: test
        run: |
          echo "test"  # put your unit test process

      - name: deployable
        id: deployable
        uses: takemikami/action-staging-control@v1
        with:
          step: check-deployable
          github-token: ${{ secrets.GITHUB_TOKEN }}

      - name: deploy
        id: deploy
        if: ${{ steps.deployable.outputs.staging == true }}
        continue-on-error: true
        run: |
          echo "deploy"  # put your deployment process
      
      - uses: takemikami/action-staging-control@v1
        with:
          step: apply-status
          github-token: ${{ secrets.GITHUB_TOKEN }}
          deploy-outcome: ${{ steps.deploy.outcome }}       
```

Add following label to your repository.

- Name: staging
- Description: Staging target pull request

Add 'staging' check to required status checks of branch protection.


### scenario

1. Make pull request.  
   run test only on GitHub Actions.
2. Add 'staging' label to the pull request and re-run GitHub Actions job.  
   run test and deploy on GitHub Actions.
3. Check deployment application and merge pull request.

If pull request that has 'staging' label is multiple, 'staging' check is failed.
