FROM node:16-bullseye-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY memorial_rms/package.json ./memorial_rms/package.json
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && pnpm --config.node-linker=isolated install --frozen-lockfile --filter memorial-release-manager --prod \
    && apt-get purge -y --auto-remove python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY memorial_rms ./memorial_rms
WORKDIR /workspace/memorial_rms

EXPOSE 4034
CMD ["node", "main.js"]
