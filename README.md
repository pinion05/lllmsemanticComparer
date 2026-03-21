# LLLM Semantic Comparer

HTML을 LLM 컨텍스트용으로 얼마나 잘 압축할 수 있는지 자동으로 연구하다가 분리된 의미 보존 평가 도구입니다.

처음 목적은 단순했습니다. 원본 HTML이나 문서를 요약/압축한 뒤, 그 결과가 원본 의미를 얼마나 보존했는지 자동으로 점수화하고 싶었습니다. 그런데 막상 연구를 진행해보니 "압축 결과가 좋은가?"를 안정적으로 판정하는 평가기가 먼저 필요했습니다. 그래서 이 저장소는 압축기 자체보다 먼저, 압축 품질을 비교할 수 있는 독립적인 semantic comparer로 정리됐습니다.

이건 HTML 압축 연구만의 문제도 아니었습니다. AI 기반 도구는 점점 더 많이 만들어지는데, 정작 무엇이 정말 잘 작동하는지 판단하는 평가지표와 평가 도구는 빈약한 경우가 많았습니다. 그 결과 "일단 생성은 되지만 신뢰하기 어려운 도구"가 계속 늘어나는 흐름도 보였습니다. 그래서 생성기만 만드는 것이 아니라, 생성 결과를 비교하고 걸러낼 수 있는 평가 도구 자체도 같이 필요하다고 생각하게 됐습니다.

이 도구는 두 문서를 읽고 OpenRouter 기반 LLM으로 다음을 평가합니다.

- 의미가 얼마나 같은지
- 정보량이 얼마나 비슷한지
- 어느 방향으로 정보가 빠졌는지
- 최종적으로 어느 정도 동등하다고 볼 수 있는지

## 왜 만들었나

HTML 압축 자동연구에서는 압축률만 보면 안 됩니다. 토큰 수가 줄어도 중요한 날짜, 숫자, 책임자, 조건, 예외, 지표가 빠지면 실패입니다. 반대로 표현만 달라지고 사실은 그대로 남아 있으면 좋은 압축일 수 있습니다.

그래서 이 도구는 "얼마나 짧아졌는가"가 아니라 아래 질문을 보도록 설계했습니다.

- 원본과 압축본이 같은 사건/결정/사실을 말하는가
- 압축 과정에서 어떤 정보가 빠졌는가
- 빠진 정보가 사소한가, 아니면 핵심인가

조금 더 넓게 보면, 이 저장소는 "AI가 무언가를 만들어내는 능력"보다 "그 결과를 신뢰할 수 있는 기준으로 평가하는 능력"이 더 중요해지는 시점에 대한 문제의식에서 나온 작업이기도 합니다.

## 개발 과정

이 프로젝트는 아래 순서로 발전했습니다.

1. 단일 LLM 호출 기반 초안
   - 처음에는 한 번 호출해서 overall score만 받는 매우 단순한 형태였습니다.
   - 하지만 경계 사례에서 점수가 자주 흔들렸습니다.

2. 점수 분해
   - `semantic_similarity`
   - `information_amount_parity`
   - `doc_a_coverage_by_doc_b`
   - `doc_b_coverage_by_doc_a`
   - 이렇게 나눠서 "왜 이런 점수가 나왔는지" 설명 가능하게 바꿨습니다.

3. 프롬프트 보수화
   - 문장 스타일이 아니라 원자 사실 단위로 비교하게 했습니다.
   - 날짜, 숫자, 소유자, 범위, 지표, 조건 변화에 더 민감하게 반응하도록 점수 앵커를 명시했습니다.

4. verdict 결정의 규칙화
   - `overall`과 `verdict`를 LLM의 즉석 주관에만 맡기지 않고, 세부 점수에서 다시 계산하도록 바꿨습니다.
   - 덕분에 경계 사례에서 `mostly_equivalent`와 `partially_equivalent`가 오락가락하는 문제가 줄었습니다.

5. 5회 샘플링 + `trimean`
   - 같은 입력을 5번 평가하고, 극단값보다 가운데 값을 더 믿는 `trimean`으로 집계합니다.
   - 요약 문장과 포인트 리스트는 최종 집계값에 가장 가까운 대표 실행 1개를 사용합니다.

6. 백오프 / 재시도 추가
   - 무료 OpenRouter 모델을 쓰면 `429`나 일시적인 형식 오류가 생길 수 있었습니다.
   - 현재는 요청 레벨 재시도와 샘플 레벨 재시도가 모두 들어가 있어, 한 번의 실패가 전체 평가를 바로 깨지 않도록 만들었습니다.

결과적으로 이 도구는 "연구용 압축기"의 부속품이 아니라, 연구 루프를 지탱하는 평가 인프라 역할을 하게 됐습니다.

## 현재 설계

한 번의 비교는 내부적으로 이렇게 진행됩니다.

1. 같은 문서쌍을 5번 평가합니다.
2. 각 실행에서 semantic / info parity / 양방향 coverage를 얻습니다.
3. 각 수치를 `trimean`으로 집계합니다.
4. 집계된 수치로 `overall_equivalence`와 `verdict`를 계산합니다.
5. 집계 수치와 가장 가까운 대표 실행 1개를 골라 summary와 포인트 목록에 사용합니다.

이 구조는 "설명 가능한 점수"와 "반복 실행 안정성" 사이의 균형을 맞추기 위해 선택했습니다.

## Requirements

- Node.js 18+
- `OPENROUTER_API_KEY`
- `OPENROUTER_DEFAULT_MODEL`

## Setup

`~/.zshrc` 같은 셸 설정 파일에 아래처럼 넣어두면 됩니다. 현재 프로세스 환경변수가 비어 있으면 이 CLI가 `~/.zshrc`에서 `OPENROUTER_API_KEY`, `OPENROUTER_DEFAULT_MODEL`을 fallback으로 읽습니다.

```bash
export OPENROUTER_API_KEY=your_key_here
export OPENROUTER_DEFAULT_MODEL=openai/gpt-4.1-mini
```

적용 후에는 `source ~/.zshrc`를 실행하거나 새 셸을 열면 됩니다.

의존성은 없습니다. 바로 실행하면 됩니다.

## Usage

기본 실행:

```bash
npm run compare -- ./doc-a.txt ./doc-b.txt
```

JSON 결과:

```bash
npm run compare -- ./doc-a.txt ./doc-b.txt --json
```

모델 강제 지정:

```bash
npm run compare -- ./doc-a.txt ./doc-b.txt --model anthropic/claude-3.7-sonnet
```

저장소에 포함된 예제로 바로 시험:

```bash
npm run compare -- ./examples/highly-equivalent-a.txt ./examples/highly-equivalent-b.txt
```

여러 패턴의 예제를 한 번에 실행:

```bash
npm run example-suite
```

## 출력 해석

기본 텍스트 출력에는 다음이 포함됩니다.

- 5회 샘플링 결과와 `trimean` 집계 정보
- `overall_equivalence`
- `semantic_similarity`
- `information_amount_parity`
- `doc_a_coverage_by_doc_b`
- `doc_b_coverage_by_doc_a`
- 대표 summary
- 공통 정보 / A에만 있는 정보 / B에만 있는 정보 / gap notes

대체로 이렇게 읽으면 됩니다.

- `semantic_similarity`가 높다
  - 같은 의미를 말하고 있을 가능성이 큽니다.
- `information_amount_parity`가 낮다
  - 한쪽이 훨씬 더 자세합니다.
- `A->B coverage`가 낮고 `B->A coverage`가 높다
  - B가 A를 압축한 형태일 가능성이 큽니다.
- `semantic_similarity`도 낮고 coverage도 낮다
  - 사실상 의미가 많이 깨진 것입니다.

## 예제 케이스

저장소에는 연구/검증용 예제가 들어 있습니다.

- 거의 완전한 패러프레이즈
- 핵심은 유지하지만 정보가 많이 압축된 버전
- 일부만 겹치는 버전
- 사실상 다른 의미가 된 버전
- 원본 / preserved / compressed / lost 예제 세트

이 예제들은 프롬프트 조정, verdict 경계 보정, 반복 실행 안정성 확인에 사용했습니다.

## 한계

- LLM 평가이므로 절대적인 진실 판정기는 아닙니다.
- 무료 모델은 rate limit과 응답 포맷 흔들림이 있습니다.
- 현재는 UTF-8 텍스트 입력 기준입니다.
- summary와 bullet 포인트는 대표 실행 1개를 사용하므로, 점수보다 표현이 조금 더 흔들릴 수 있습니다.

그래도 현재 구조는 "압축 후보 여러 개를 자동으로 비교하고, 어떤 방식이 의미 보존에 유리한지 연구하는 용도"에는 꽤 잘 맞습니다.
