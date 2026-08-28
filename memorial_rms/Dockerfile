FROM node:16-bullseye-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@8.15.9 --activate
WORKDIR /workspace/memorial_rms
COPY memorial_rms/package.json memorial_rms/pnpm-lock.yaml ./
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && pnpm install --frozen-lockfile --prod \
    && apt-get purge -y --auto-remove python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY memorial_rms ./

EXPOSE 4034
CMD ["node", "main.js"]
