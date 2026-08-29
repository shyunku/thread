FROM node:16-bullseye-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@8.15.9 --activate
WORKDIR /workspace/service
COPY services/rms/package.json services/rms/pnpm-lock.yaml ./
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && pnpm install --frozen-lockfile --prod \
    && apt-get purge -y --auto-remove python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY services/rms ./

EXPOSE 4034
CMD ["node", "main.js"]
