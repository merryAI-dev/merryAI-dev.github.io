# MYSCube Engineering

MYSC AX팀의 기술 블로그입니다. GitHub Pages와 Jekyll로 발행하고 MYSC 내장 편집기를 비개발자용 글쓰기 화면으로 사용합니다.

## 글 작성

1. `https://merryai-dev.github.io/admin/`에 접속합니다.
2. **새 글 쓰기**를 누르고 GitHub로 로그인합니다.
3. 제목·요약·태그와 본문을 작성하고 이미지를 끌어다 놓습니다.
4. 새 글은 기본적으로 비공개 초안입니다. 검토가 끝나면 **공개 발행**을 켜고 저장합니다.
5. 저장한 변경은 GitHub 이력에 남고 GitHub Pages가 자동 배포합니다.

MYSC Writing Studio GitHub App은 이 저장소에만 설치하고 최소 권한으로 운영합니다. 토큰이나 API 키를 저장소에 추가하지 않습니다.

직접 편집기 주소는 다음과 같습니다.

- 새 글·글 수정: `https://mysc-writing-studio.vercel.app/`

## 로컬 확인

```bash
bundle install
bundle exec jekyll serve
```
