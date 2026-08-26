FROM node:16-alpine AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY memorial_site/package.json ./memorial_site/package.json
RUN pnpm --config.node-linker=isolated install --frozen-lockfile --ignore-scripts --filter memorial_site...
COPY memorial_site ./memorial_site
RUN pnpm --dir memorial_site build

FROM nginx:1.27-alpine
COPY memorial_site/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /workspace/memorial_site/build /usr/share/nginx/html
EXPOSE 80
