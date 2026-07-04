<header class="govuk-header">
	<div class="govuk-header__container">
		<span class="govuk-header__logo">
			<span class="govuk-header__crown">🚇</span>
		</span>
		<a class="govuk-header__service-name" href="/">Tubemaxxing</a>
		<nav class="govuk-header__nav">
			<a class="govuk-header__link" href="/disruptions">Disruptions</a>
		</nav>
	</div>
</header>

<style>
	.govuk-header {
		background: #0b0c0c;
		border-bottom: 10px solid #1d70b8;
	}

	.govuk-header__container {
		max-width: 28rem;
		margin: 0 auto;
		padding: 0.75rem 1rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.govuk-header__crown {
		font-size: 1.5rem;
		line-height: 1;
	}

	.govuk-header__service-name {
		color: #ffffff;
		font-size: 1.125rem;
		font-weight: 700;
		font-family: "GDS Transport", arial, sans-serif;
		text-decoration: none;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.govuk-header__nav {
		margin-left: auto;
	}

	.govuk-header__link {
		color: #ffffff;
		font-size: 1.05rem;
		text-decoration: underline;
	}

	.govuk-header__link:hover {
		text-decoration: none;
	}
</style>
